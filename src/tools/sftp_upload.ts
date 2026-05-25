import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { isReadOnlyMode, isCommandDenied } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export const sftpUploadSchema = z.object({
  session_id: z.string().min(1),
  local_path: z.string().min(1).describe('Absolute path to the local file to upload'),
  remote_path: z.string().min(1).describe('Absolute destination path on the remote host'),
});

export const sftpUploadTool = {
  name: 'sftp_upload',
  description:
    'Upload a local file to a remote host via SFTP. Requires an active session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
      local_path: {
        type: 'string',
        description: 'Absolute local file path to upload',
      },
      remote_path: {
        type: 'string',
        description: 'Absolute destination path on the remote host',
      },
    },
    required: ['session_id', 'local_path', 'remote_path'],
  },
};

export async function handleSftpUpload(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  if (isReadOnlyMode()) {
    return {
      content: [{ type: 'text' as const, text: 'Error: Server is in read-only mode. SFTP upload is disabled.' }],
      isError: true,
    };
  }

  const parsed = sftpUploadSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { session_id, local_path, remote_path } = parsed.data;

  const session = sessionManager.get(session_id);
  if (!session) {
    return {
      content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found or has been disconnected` }],
      isError: true,
    };
  }

  if (!sshManager.isAlive(session.ssh)) {
    return {
      content: [{ type: 'text' as const, text: `Error: SSH connection for session '${session_id}' is dead. Reconnect with connect or reconnect_to_tmux.` }],
      isError: true,
    };
  }

  // Security: resolve and validate local path
  const resolvedLocal = path.resolve(local_path);
  if (!fs.existsSync(resolvedLocal)) {
    return {
      content: [{ type: 'text' as const, text: `Error: Local file not found: ${resolvedLocal}` }],
      isError: true,
    };
  }
  if (!fs.statSync(resolvedLocal).isFile()) {
    return {
      content: [{ type: 'text' as const, text: `Error: Local path is not a file: ${resolvedLocal}` }],
      isError: true,
    };
  }

  try {
    await sshManager.sftpUpload(session.ssh, resolvedLocal, remote_path);
    const size = fs.statSync(resolvedLocal).size;
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'uploaded',
          local_path: resolvedLocal,
          remote_path,
          size_bytes: size,
        }, null, 2),
      }],
    };
  } catch (err) {
    logger.error({ sessionId: session_id, error: (err as Error).message }, 'SFTP upload failed');
    return {
      content: [{ type: 'text' as const, text: `Error: SFTP upload failed: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
