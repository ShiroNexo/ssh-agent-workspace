import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { TmuxManager, MCP_PROMPT } from '../core/TmuxManager.js';
import { listHostAliases, getHostConfig } from '../utils/sshConfig.js';
import { buildSshConfig } from '../utils/ssh.js';
import { sanitizeTmuxSessionName } from '../utils/validation.js';
import { isHostAllowed } from '../utils/security.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export const connectSchema = z.object({
  host: z.string().min(1).describe('SSH host alias from ~/.ssh/config'),
});

export const connectTool = {
  name: 'connect',
  description:
    'Connect to a remote host via SSH and establish a persistent tmux-backed interactive shell session. Supports bash and zsh only.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      host: {
        type: 'string',
        description: 'SSH host alias from ~/.ssh/config',
      },
    },
    required: ['host'],
  },
};

export async function handleConnect(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager,
  tmuxManager: TmuxManager
) {
  const parsed = connectSchema.safeParse(args);
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

  const { host } = parsed.data;

  // Security: check host allowlist
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

  // Validate host exists in SSH config
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

  const sshConfig = buildSshConfig(hostConfig);
  if (!sshConfig) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Failed to read SSH private key for '${host}'`,
        },
      ],
      isError: true,
    };
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

  // Check tmux is installed
  const tmuxInstalled = await tmuxManager.isInstalled(ssh);
  if (!tmuxInstalled) {
    sshManager.disconnect(ssh);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: tmux is not installed on host '${host}'. Please install tmux first.`,
        },
      ],
      isError: true,
    };
  }

  const tmuxSessionName = `mcp_${sanitizeTmuxSessionName(host)}_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

  try {
    await tmuxManager.createOrAttachSession(ssh, tmuxSessionName);
  } catch (err) {
    sshManager.disconnect(ssh);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Failed to create tmux session: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // Detect shell
  let shell: string | null = null;
  try {
    shell = await tmuxManager.detectShell(ssh, tmuxSessionName);
  } catch (err) {
    logger.warn(
      { host, error: (err as Error).message },
      'Shell detection failed, continuing anyway'
    );
  }

  const supportedShells = ['bash', 'zsh'];
  if (shell && !supportedShells.includes(shell)) {
    try {
      await tmuxManager.killSession(ssh, tmuxSessionName);
    } catch {}
    sshManager.disconnect(ssh);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Unsupported shell '${shell}' on host '${host}'. Only bash and zsh are supported in V1.`,
        },
      ],
      isError: true,
    };
  }

  // Inject deterministic prompt with retry + verification
  let promptInjected = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await new Promise((r) => setTimeout(r, 300));
      await tmuxManager.injectPrompt(ssh, tmuxSessionName);
      await new Promise((r) => setTimeout(r, 300));
      const output = await tmuxManager.capturePane(ssh, tmuxSessionName, 10);
      if (output.includes(MCP_PROMPT)) {
        promptInjected = true;
        break;
      }
    } catch {
      logger.warn({ host, attempt }, 'Prompt injection retry');
    }
  }
  if (!promptInjected) {
    logger.warn({ host }, 'Failed to inject deterministic prompt after retries, continuing');
  }

  // Apply tmux options for AI-friendly behavior
  try {
    await tmuxManager.applyOptions(ssh, tmuxSessionName);
  } catch (err) {
    logger.warn(
      { host, tmuxSessionName, error: (err as Error).message },
      'Failed to apply tmux options, continuing anyway'
    );
  }

  const session = sessionManager.create(host, ssh, tmuxSessionName, shell || undefined);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            session_id: session.id,
            host: session.host,
            tmux_session: session.tmuxSession,
            shell: shell || 'unknown',
          },
          null,
          2
        ),
      },
    ],
  };
}
