import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import type { ConnectConfig } from 'ssh2';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { TmuxManager, MCP_PROMPT } from '../core/TmuxManager.js';
import { listHostAliases, getHostConfig } from '../utils/sshConfig.js';
import { isHostAllowed } from '../utils/security.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export const reconnectSchema = z.object({
  host: z.string().min(1).describe('SSH host alias from ~/.ssh/config'),
  tmux_session: z.string().min(1).describe('Name of the existing tmux session on the remote host'),
});

export const reconnectTool = {
  name: 'reconnect_to_tmux',
  description:
    'Reconnect to an existing tmux session on a remote host. Useful for recovery after MCP restarts or SSH disconnections.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      host: {
        type: 'string',
        description: 'SSH host alias from ~/.ssh/config',
      },
      tmux_session: {
        type: 'string',
        description: 'Name of the existing tmux session on the remote host',
      },
    },
    required: ['host', 'tmux_session'],
  },
};

export async function handleReconnect(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager,
  tmuxManager: TmuxManager
) {
  const parsed = reconnectSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Invalid arguments: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { host, tmux_session } = parsed.data;

  if (!isHostAllowed(host)) {
    logger.warn({ host }, 'Host rejected by allowlist');
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Host '${host}' is not in the allowed hosts list`,
        },
      ],
      isError: true,
    };
  }

  const aliases = listHostAliases();
  if (!aliases.includes(host)) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Host alias '${host}' not found in SSH config.\nAvailable aliases: ${aliases.join(', ') || '(none)'}`,
        },
      ],
      isError: true,
    };
  }

  const hostConfig = getHostConfig(host);
  if (!hostConfig) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Failed to resolve SSH configuration for '${host}'`,
        },
      ],
      isError: true,
    };
  }

  const sshConfig: ConnectConfig = {
    host: hostConfig.hostname || host,
    port: hostConfig.port || 22,
    username: hostConfig.user || process.env.USER || 'root',
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
  };

  if (hostConfig.identityFile) {
    const keyPath = hostConfig.identityFile.replace(/^~(?=$|\/)/, os.homedir());
    if (fs.existsSync(keyPath)) {
      try {
        sshConfig.privateKey = fs.readFileSync(keyPath);
      } catch (err) {
        logger.error({ keyPath, error: (err as Error).message }, 'Failed to read SSH private key');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Failed to read SSH key at ${keyPath}`,
            },
          ],
          isError: true,
        };
      }
    } else {
      logger.warn({ keyPath }, 'SSH private key not found, attempting connection without explicit key');
    }
  }

  let ssh;
  try {
    ssh = await sshManager.connect(sshConfig);
  } catch (err) {
    logger.error({ host, error: (err as Error).message }, 'SSH connection failed');
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: SSH connection failed: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  const tmuxInstalled = await tmuxManager.isInstalled(ssh);
  if (!tmuxInstalled) {
    sshManager.disconnect(ssh);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: tmux is not installed on host '${host}'.`,
        },
      ],
      isError: true,
    };
  }

  const exists = await tmuxManager.hasSession(ssh, tmux_session);
  if (!exists) {
    sshManager.disconnect(ssh);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: tmux session '${tmux_session}' does not exist on host '${host}'.`,
        },
      ],
      isError: true,
    };
  }

  // Inject deterministic prompt if it seems missing
  try {
    const output = await tmuxManager.capturePane(ssh, tmux_session, 5);
    if (!output.includes(MCP_PROMPT)) {
      await tmuxManager.injectPrompt(ssh, tmux_session);
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (err) {
    logger.warn({ host, tmux_session, error: (err as Error).message }, 'Prompt check/inject failed');
  }

  const session = sessionManager.create(host, ssh, tmux_session);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            session_id: session.id,
            host: session.host,
            tmux_session: session.tmuxSession,
            status: 'reconnected',
          },
          null,
          2
        ),
      },
    ],
  };
}
