import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager, type SFTPEntry } from '../core/SSHManager.js';
import { isReadOnlyMode } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export const sftpListSchema = z.object({
  session_id: z.string().min(1),
  path: z.string().default('/').describe('Absolute directory path on the remote host'),
});

export const sftpListTool = {
  name: 'sftp_list',
  description:
    'List files and directories on a remote host via SFTP. Requires an active session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
      path: {
        type: 'string',
        description: 'Absolute directory path on the remote host (default: /)',
        default: '/',
      },
    },
    required: ['session_id'],
  },
};

function formatEntry(entry: SFTPEntry): string {
  const type = entry.attrs.isDirectory ? 'd' : entry.attrs.isSymbolicLink ? 'l' : '-';
  const modeStr = entry.attrs.mode.toString(8).slice(-3);
  const size = entry.attrs.isDirectory ? '-' : entry.attrs.size.toString();
  const mtime = new Date(entry.attrs.mtime * 1000).toISOString().replace('T', ' ').slice(0, 19);
  return `${type}${modeStr} ${size.padStart(10)} ${mtime} ${entry.filename}`;
}

export async function handleSftpList(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  if (isReadOnlyMode()) {
    // sftp_list is read-only, allow even in readonly mode
  }

  const parsed = sftpListSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { session_id, path: remotePath } = parsed.data;

  const session = sessionManager.get(session_id);
  if (!session) {
    return {
      content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found or has been disconnected` }],
      isError: true,
    };
  }

  try {
    const entries = await sshManager.sftpList(session.ssh, remotePath);
    // Sort: directories first, then by name
    entries.sort((a, b) => {
      if (a.attrs.isDirectory !== b.attrs.isDirectory) {
        return a.attrs.isDirectory ? -1 : 1;
      }
      return a.filename.localeCompare(b.filename);
    });

    const lines = entries.map(formatEntry);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          path: remotePath,
          entries: entries.map((e) => ({
            name: e.filename,
            type: e.attrs.isDirectory ? 'directory' : e.attrs.isSymbolicLink ? 'symlink' : 'file',
            size: e.attrs.size,
            mtime: new Date(e.attrs.mtime * 1000).toISOString(),
          })),
          display: lines.join('\n'),
        }, null, 2),
      }],
    };
  } catch (err) {
    logger.error({ sessionId: session_id, error: (err as Error).message }, 'SFTP list failed');
    return {
      content: [{ type: 'text' as const, text: `Error: SFTP list failed: ${(err as Error).message}` }],
      isError: true,
    };
  }
}
