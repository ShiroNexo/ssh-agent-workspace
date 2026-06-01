import { z } from 'zod';
import net from 'net';
import type { Client } from 'ssh2';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { getHostConfig } from '../utils/sshConfig.js';
import { buildSshConfig } from '../utils/ssh.js';
import { isReadOnlyMode, isHostAllowed } from '../utils/security.js';
import { logger } from '../utils/logger.js';

interface Tunnel {
  id: string;
  type: 'local' | 'socks5';
  host: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  ssh: Client;
  server: net.Server;
  createdAt: number;
}

const tunnels = new Map<string, Tunnel>();
let tunnelCounter = 0;

export const tunnelOpenSchema = z.object({
  session_id: z.string().min(1),
  type: z.enum(['local', 'socks5']).describe('Tunnel type: local port forward or SOCKS5 proxy'),
  local_port: z.number().int().min(1).max(65535).describe('Local port to listen on'),
  remote_host: z.string().min(1).describe('Remote host to forward to (ignored for SOCKS5, use target via proxy)'),
  remote_port: z.number().int().min(1).max(65535).describe('Remote port to forward to (ignored for SOCKS5)'),
});

export const tunnelCloseSchema = z.object({
  tunnel_id: z.string().min(1),
});

export const tunnelListSchema = z.object({});

export const tunnelOpenTool = {
  name: 'ssh_tunnel_open',
  description:
    'Open an SSH tunnel: local port forwarding or SOCKS5 proxy. Creates a dedicated SSH connection. Use ssh_tunnel_list to see active tunnels and ssh_tunnel_close to stop them.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect (used to resolve host config)',
      },
      type: {
        type: 'string',
        description: 'Tunnel type. "local" forwards local_port -> remote_host:remote_port. "socks5" starts a SOCKS5 proxy.',
        enum: ['local', 'socks5'],
      },
      local_port: {
        type: 'number',
        description: 'Local port to listen on (1-65535)',
      },
      remote_host: {
        type: 'string',
        description: 'Target host on the remote side. For "local" type, traffic arriving at local_port is forwarded here.',
      },
      remote_port: {
        type: 'number',
        description: 'Target port on the remote side. For "local" type, traffic arriving at local_port is forwarded here.',
      },
    },
    required: ['session_id', 'type', 'local_port', 'remote_host', 'remote_port'],
  },
};

export const tunnelCloseTool = {
  name: 'ssh_tunnel_close',
  description: 'Close and clean up an active SSH tunnel.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tunnel_id: { type: 'string', description: 'Tunnel ID from ssh_tunnel_open or ssh_tunnel_list' },
    },
    required: ['tunnel_id'],
  },
};

export const tunnelListTool = {
  name: 'ssh_tunnel_list',
  description: 'List all active SSH tunnels with their IDs, types, and ports.',
  inputSchema: { type: 'object' as const, properties: {} },
};

function freePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function closeTunnel(id: string): boolean {
  const tunnel = tunnels.get(id);
  if (!tunnel) return false;
  try { tunnel.server.close(); } catch {}
  try { tunnel.ssh.destroy(); } catch {}
  tunnels.delete(id);
  logger.info({ tunnelId: id, host: tunnel.host, localPort: tunnel.localPort }, 'Tunnel closed');
  return true;
}

export async function handleTunnelOpen(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  const parsed = tunnelOpenSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  }

  const { session_id, type, local_port, remote_host, remote_port } = parsed.data;
  const session = sessionManager.get(session_id);
  if (!session) {
    return { content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found` }], isError: true };
  }

  if (isReadOnlyMode(session.host)) {
    return { content: [{ type: 'text' as const, text: `Error: Host '${session.host}' is in read-only mode. Tunnels are disabled.` }], isError: true };
  }

  if (!isHostAllowed(session.host)) {
    return { content: [{ type: 'text' as const, text: `Error: Host '${session.host}' is not allowed` }], isError: true };
  }

  const available = await freePort(local_port);
  if (!available) {
    return { content: [{ type: 'text' as const, text: `Error: Local port ${local_port} is already in use` }], isError: true };
  }

  const hostConfig = getHostConfig(session.host);
  if (!hostConfig) {
    return { content: [{ type: 'text' as const, text: `Error: Failed to resolve SSH config for '${session.host}'` }], isError: true };
  }

  const sshConfig = buildSshConfig(hostConfig);
  if (!sshConfig) {
    return { content: [{ type: 'text' as const, text: `Error: Failed to build SSH config for '${session.host}'` }], isError: true };
  }

  let tunnelSsh: Client;
  try {
    tunnelSsh = await sshManager.connect(sshConfig);
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Error: SSH tunnel connection failed: ${(err as Error).message}` }], isError: true };
  }

  const tunnelId = `tun_${++tunnelCounter}_${Date.now().toString(36)}`;

  const server = net.createServer((localSocket) => {
    if (type === 'local') {
      tunnelSsh.forwardOut('127.0.0.1', local_port, remote_host, remote_port, (err, sshStream) => {
        if (err) {
          logger.warn({ tunnelId, error: err.message }, 'SSH forwardOut failed');
          localSocket.destroy();
          return;
        }
        localSocket.pipe(sshStream).pipe(localSocket);
        localSocket.on('error', () => {});
        sshStream.on('error', () => { localSocket.destroy(); });
      });
    } else {
      handleSocks5(localSocket, tunnelSsh, tunnelId);
    }
  });

  server.on('error', (err) => {
    logger.error({ tunnelId, error: err.message }, 'Tunnel server error');
    closeTunnel(tunnelId);
  });

  tunnelSsh.on('close', () => {
    logger.info({ tunnelId }, 'Tunnel SSH connection closed');
    closeTunnel(tunnelId);
  });

  tunnelSsh.on('error', (err) => {
    logger.warn({ tunnelId, error: err.message }, 'Tunnel SSH error');
  });

  server.listen(local_port, '127.0.0.1', () => {
    logger.info({ tunnelId, type, localPort: local_port, remoteHost: remote_host, remotePort: remote_port }, 'Tunnel opened');
  });

  const tunnel: Tunnel = { id: tunnelId, type, host: session.host, localPort: local_port, remoteHost: remote_host, remotePort: remote_port, ssh: tunnelSsh, server, createdAt: Date.now() };
  tunnels.set(tunnelId, tunnel);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        tunnel_id: tunnelId,
        type,
        host: session.host,
        local_port,
        remote_host: type === 'local' ? remote_host : 'any (SOCKS5)',
        remote_port: type === 'local' ? remote_port : 'any (SOCKS5)',
        status: 'active',
        note: type === 'socks5' ? 'Use localhost:LOCAL_PORT as SOCKS5 proxy' : `Forwarding localhost:${local_port} -> ${remote_host}:${remote_port}`,
      }, null, 2),
    }],
  };
}

export async function handleTunnelClose(args: unknown) {
  const parsed = tunnelCloseSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  }

  const closed = closeTunnel(parsed.data.tunnel_id);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ tunnel_id: parsed.data.tunnel_id, closed }, null, 2) }],
  };
}

export async function handleTunnelList() {
  const list = Array.from(tunnels.values()).map((t) => ({
    tunnel_id: t.id,
    type: t.type,
    host: t.host,
    local_port: t.localPort,
    remote_host: t.type === 'local' ? t.remoteHost : 'any (SOCKS5)',
    remote_port: t.type === 'local' ? t.remotePort : 'any (SOCKS5)',
    created_at: new Date(t.createdAt).toISOString(),
  }));

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ tunnels: list, count: list.length }, null, 2) }],
  };
}

function handleSocks5(localSocket: net.Socket, ssh: Client, tunnelId: string) {
  localSocket.once('data', (data) => {
    if (data[0] !== 0x05) {
      localSocket.destroy();
      return;
    }

    const nmethods = data[1];
    let supportsNoAuth = false;
    for (let i = 0; i < nmethods; i++) {
      if (data[2 + i] === 0x00) { supportsNoAuth = true; break; }
    }

    if (!supportsNoAuth) {
      localSocket.write(Buffer.from([0x05, 0xff]));
      localSocket.destroy();
      return;
    }

    localSocket.write(Buffer.from([0x05, 0x00]));

    localSocket.once('data', (req) => {
      if (req[0] !== 0x05 || req[1] !== 0x01) {
        localSocket.destroy();
        return;
      }

      const atyp = req[3];
      let dstHost: string;
      let dstPort: number;
      let offset: number;

      if (atyp === 0x01) {
        dstHost = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
        dstPort = req.readUInt16BE(8);
        offset = 10;
      } else if (atyp === 0x03) {
        const hostLen = req[4];
        dstHost = req.slice(5, 5 + hostLen).toString('utf8');
        dstPort = req.readUInt16BE(5 + hostLen);
        offset = 7 + hostLen;
      } else if (atyp === 0x04) {
        const parts: string[] = [];
        for (let i = 0; i < 8; i++) {
          parts.push(req.readUInt16BE(4 + i * 2).toString(16));
        }
        dstHost = parts.join(':');
        dstPort = req.readUInt16BE(20);
        offset = 22;
      } else {
        localSocket.destroy();
        return;
      }

      ssh.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, sshStream) => {
        if (err) {
          logger.warn({ tunnelId, dstHost, dstPort, error: err.message }, 'SOCKS5 forwardOut failed');
          const reply = Buffer.alloc(offset);
          reply[0] = 0x05; reply[1] = 0x04; reply[2] = 0x00; reply[3] = 0x01;
          reply.fill(0, 4, offset);
          localSocket.write(reply);
          localSocket.destroy();
          return;
        }

        const reply = Buffer.alloc(offset);
        reply[0] = 0x05; reply[1] = 0x00; reply[2] = 0x00; reply[3] = 0x01;
        reply.fill(0, 4, offset);
        localSocket.write(reply);

        localSocket.pipe(sshStream).pipe(localSocket);
        localSocket.on('error', () => {});
        sshStream.on('error', () => { localSocket.destroy(); });
      });
    });
  });
}
