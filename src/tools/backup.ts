import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager } from '../core/SSHManager.js';
import { isCommandDenied, isReadOnlyMode } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export const backupSchema = z.object({
  session_id: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1).max(100).describe('Absolute remote paths (files or directories) to include in the backup archive'),
  local_dest: z.string().min(1).describe('Absolute local path where the backup archive will be saved (must end with .tar.gz)'),
  exclude: z.array(z.string()).max(20).default([]).describe('Glob patterns to exclude (e.g. "*.log", "node_modules")'),
  remove_remote_archive: z.boolean().default(true).describe('Delete the temporary archive from the remote host after download'),
});

export const backupTool = {
  name: 'backup',
  description:
    'Create a compressed tar.gz backup of remote paths and download it locally. Steps: validate paths -> create remote archive -> download -> cleanup.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: { type: 'string', description: 'Session ID returned by connect' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute remote paths (files/directories) to backup',
      },
      local_dest: { type: 'string', description: 'Absolute local path to save the .tar.gz archive' },
      exclude: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns to exclude (e.g. "*.log", "node_modules")',
        default: [],
      },
      remove_remote_archive: { type: 'boolean', description: 'Delete remote temp archive after download (default: true)', default: true },
    },
    required: ['session_id', 'paths', 'local_dest'],
  },
};

function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function handleBackup(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  const parsed = backupSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  }

  const { session_id, paths, local_dest, exclude, remove_remote_archive } = parsed.data;
  const session = sessionManager.get(session_id);

  if (!session) {
    return { content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found` }], isError: true };
  }
  if (!sshManager.isAlive(session.ssh)) {
    return { content: [{ type: 'text' as const, text: `Error: SSH connection dead for session '${session_id}'` }], isError: true };
  }

  if (isReadOnlyMode(session.host)) {
    return { content: [{ type: 'text' as const, text: `Error: Host '${session.host}' is in read-only mode. Backup is disabled.` }], isError: true };
  }

  if (!local_dest.endsWith('.tar.gz')) {
    return {
      content: [{ type: 'text' as const, text: 'Error: local_dest must end with .tar.gz' }],
      isError: true,
    };
  }

  for (const p of paths) {
    if (p.startsWith('-') || p.includes(';') || p.includes('&&') || p.includes('|')) {
      return {
        content: [{ type: 'text' as const, text: `Error: Invalid characters in path: ${p}` }],
        isError: true,
      };
    }
  }

  const resolvedLocal = path.resolve(local_dest);
  const localDir = path.dirname(resolvedLocal);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  if (fs.existsSync(resolvedLocal)) {
    return {
      content: [{ type: 'text' as const, text: `Error: Local file already exists: ${resolvedLocal}` }],
      isError: true,
    };
  }

  const verifyScript = paths.map((p) => `test -e ${q(p)} || echo "MISSING:${p}"`).join('; ');
  const verifyResult = await sshManager.exec(session.ssh, verifyScript, 10000);

  if (verifyResult.stdout.includes('MISSING:')) {
    const missing = verifyResult.stdout
      .split('\n')
      .filter((l) => l.startsWith('MISSING:'))
      .map((l) => l.replace('MISSING:', ''))
      .join(', ');
    return {
      content: [{ type: 'text' as const, text: `Error: Remote paths not found: ${missing}` }],
      isError: true,
    };
  }

  const timestamp = Date.now();
  const archiveName = `mcp_backup_${timestamp}.tar.gz`;
  const remoteArchive = `/tmp/${archiveName}`;

  const excludeArgs = exclude.map((e) => `--exclude=${q(e)}`).join(' ');
  const pathArgs = paths.map((p) => q(p)).join(' ');
  const tarCmd = `tar czf ${q(remoteArchive)} ${excludeArgs} ${pathArgs} 2>&1`;

  const tarResult = await sshManager.exec(session.ssh, tarCmd, 120000);

  if (tarResult.code !== 0) {
    const error = tarResult.stderr || tarResult.stdout || 'unknown error';
    logger.error({ sessionId: session_id, paths, error }, 'Tar backup failed');
    return {
      content: [{ type: 'text' as const, text: `Error: Failed to create remote archive: ${error}` }],
      isError: true,
    };
  }

  const statResult = await sshManager.exec(session.ssh, `stat -c%s ${q(remoteArchive)} 2>/dev/null || wc -c < ${q(remoteArchive)}`, 5000);
  let archiveSize = parseInt(statResult.stdout.trim(), 10);
  if (isNaN(archiveSize)) archiveSize = 0;

  try {
    await sshManager.sftpDownload(session.ssh, remoteArchive, resolvedLocal);
  } catch (err) {
    logger.error({ sessionId: session_id, remoteArchive, localDest: resolvedLocal, error: (err as Error).message }, 'Backup download failed');
    try { await sshManager.exec(session.ssh, `rm -f ${q(remoteArchive)}`, 5000); } catch {}
    return {
      content: [{ type: 'text' as const, text: `Error: Download failed: ${(err as Error).message}` }],
      isError: true,
    };
  }

  const localSize = fs.statSync(resolvedLocal).size;

  if (remove_remote_archive) {
    try {
      await sshManager.exec(session.ssh, `rm -f ${q(remoteArchive)}`, 5000);
    } catch {
      logger.warn({ sessionId: session_id, remoteArchive }, 'Failed to clean up remote archive');
    }
  }

  logger.info({ sessionId: session_id, paths, archiveSize, localSize, localDest: resolvedLocal }, 'Backup complete');

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        session_id,
        local_path: resolvedLocal,
        remote_archive_removed: remove_remote_archive,
        archive_size_bytes: localSize,
        paths_backed_up: paths,
        excluded_patterns: exclude,
        timestamp: new Date().toISOString(),
      }, null, 2),
    }],
  };
}
