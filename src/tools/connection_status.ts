import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { TmuxManager } from '../core/TmuxManager.js';
import { logger } from '../utils/logger.js';

export const connectionStatusSchema = z.object({
  session_id: z.string().min(1),
});

export const connectionStatusTool = {
  name: 'connection_status',
  description:
    'Check the health of an active session: SSH connection liveness and tmux session existence.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
    },
    required: ['session_id'],
  },
};

export async function handleConnectionStatus(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager,
  tmuxManager: TmuxManager
) {
  const parsed = connectionStatusSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { session_id } = parsed.data;
  const session = sessionManager.get(session_id);

  if (!session) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        session_id,
        exists: false,
        ssh_alive: false,
        tmux_exists: false,
      }, null, 2) }],
    };
  }

  let sshAlive = sshManager.isAlive(session.ssh);
  let tmuxExists = false;

  if (sshAlive) {
    try {
      tmuxExists = await tmuxManager.hasSession(session.ssh, session.tmuxSession);
    } catch (err) {
      logger.warn({ sessionId: session_id, error: (err as Error).message }, 'tmux hasSession check failed');
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        session_id,
        host: session.host,
        exists: true,
        ssh_alive: sshAlive,
        tmux_exists: tmuxExists,
        tmux_session: session.tmuxSession,
        shell: session.shell || 'unknown',
        connected_at: new Date(session.connectedAt).toISOString(),
        last_activity: new Date(session.lastActivity).toISOString(),
      }, null, 2),
    }],
  };
}
