import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { SessionManager } from '../core/SessionManager.js';
import { SSHManager, type SFTPEntry } from '../core/SSHManager.js';
import { isReadOnlyMode } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export const syncSchema = z.object({
  session_id: z.string().min(1),
  local_path: z.string().min(1).describe('Absolute local directory path'),
  remote_path: z.string().min(1).describe('Absolute remote directory path'),
  direction: z.enum(['upload', 'download', 'bidirectional']).default('upload').describe('Sync direction'),
  dry_run: z.boolean().default(false).describe('Preview changes without actually transferring files'),
  max_depth: z.number().int().min(1).max(20).default(10).describe('Maximum directory recursion depth'),
});

export const syncTool = {
  name: 'sync',
  description:
    'Bidirectional rsync-like sync between local and remote directories via SFTP. Compares files by mtime and size, transfers only changed/new files. Supports dry-run preview.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: { type: 'string', description: 'Session ID returned by connect' },
      local_path: { type: 'string', description: 'Absolute local directory path' },
      remote_path: { type: 'string', description: 'Absolute remote directory path' },
      direction: {
        type: 'string',
        description: 'upload (local->remote), download (remote->local), or bidirectional (both ways, newest wins)',
        enum: ['upload', 'download', 'bidirectional'],
        default: 'upload',
      },
      dry_run: { type: 'boolean', description: 'Preview changes without transferring (default: false)', default: false },
      max_depth: { type: 'number', description: 'Max directory depth (default: 10)', default: 10 },
    },
    required: ['session_id', 'local_path', 'remote_path'],
  },
};

interface FileInfo {
  relPath: string;
  size: number;
  mtime: number;
}

interface SyncResult {
  direction: string;
  rel_path: string;
  size: number;
  reason: 'new' | 'updated' | 'newer';
}

interface SyncReport {
  session_id: string;
  dry_run: boolean;
  direction: string;
  local_path: string;
  remote_path: string;
  synced: SyncResult[];
  skipped: number;
  errors: string[];
}

async function listLocalRecursive(
  dirPath: string,
  maxDepth: number,
  currentDepth: number,
  prefix: string
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  if (currentDepth > maxDepth) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        results.push({ relPath, size: stat.size, mtime: Math.floor(stat.mtimeMs) });
      } catch { continue; }
    } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const children = await listLocalRecursive(fullPath, maxDepth, currentDepth + 1, relPath);
      results.push(...children);
    }
  }

  return results;
}

async function listRemoteRecursive(
  sshManager: SSHManager,
  session: { ssh: import('ssh2').Client },
  remotePath: string,
  maxDepth: number,
  currentDepth: number,
  prefix: string
): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  if (currentDepth > maxDepth) return results;

  let entries: SFTPEntry[];
  try {
    entries = await sshManager.sftpList(session.ssh, remotePath);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue;
    if (entry.filename.startsWith('.')) continue;

    const fullPath = remotePath.endsWith('/') ? `${remotePath}${entry.filename}` : `${remotePath}/${entry.filename}`;
    const relPath = prefix ? `${prefix}/${entry.filename}` : entry.filename;

    if (entry.attrs.isFile) {
      results.push({ relPath, size: entry.attrs.size, mtime: entry.attrs.mtime });
    } else if (entry.attrs.isDirectory && !entry.attrs.isSymbolicLink) {
      const children = await listRemoteRecursive(sshManager, session, fullPath, maxDepth, currentDepth + 1, relPath);
      results.push(...children);
    }
  }

  return results;
}

export async function handleSync(
  args: unknown,
  sessionManager: SessionManager,
  sshManager: SSHManager
) {
  const parsed = syncSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  }

  const { session_id, local_path, remote_path, direction, dry_run, max_depth } = parsed.data;
  const session = sessionManager.get(session_id);

  if (!session) {
    return { content: [{ type: 'text' as const, text: `Error: Session '${session_id}' not found` }], isError: true };
  }
  if (!sshManager.isAlive(session.ssh)) {
    return { content: [{ type: 'text' as const, text: `Error: SSH connection dead for session '${session_id}'` }], isError: true };
  }

  if (isReadOnlyMode(session.host)) {
    return { content: [{ type: 'text' as const, text: `Error: Host '${session.host}' is in read-only mode. Sync is disabled.` }], isError: true };
  }

  const resolvedLocal = path.resolve(local_path);
  if (!fs.existsSync(resolvedLocal)) {
    return {
      content: [{ type: 'text' as const, text: `Error: Local directory not found: ${resolvedLocal}` }],
      isError: true,
    };
  }
  if (!fs.statSync(resolvedLocal).isDirectory()) {
    return {
      content: [{ type: 'text' as const, text: `Error: Local path is not a directory: ${resolvedLocal}` }],
      isError: true,
    };
  }

  const remoteExists = await sshManager.sftpExists(session.ssh, remote_path);
  if (!remoteExists) {
    return {
      content: [{ type: 'text' as const, text: `Error: Remote directory not found: ${remote_path}` }],
      isError: true,
    };
  }

  const report: SyncReport = {
    session_id,
    dry_run,
    direction,
    local_path: resolvedLocal,
    remote_path,
    synced: [],
    skipped: 0,
    errors: [],
  };

  let localFiles: FileInfo[] = [];
  let remoteFiles: FileInfo[] = [];

  try {
    localFiles = await listLocalRecursive(resolvedLocal, max_depth, 0, '');
  } catch (err) {
    report.errors.push(`Local listing failed: ${(err as Error).message}`);
  }

  try {
    remoteFiles = await listRemoteRecursive(sshManager, session, remote_path, max_depth, 0, '');
  } catch (err) {
    report.errors.push(`Remote listing failed: ${(err as Error).message}`);
  }

  const localMap = new Map(localFiles.map((f) => [f.relPath, f]));
  const remoteMap = new Map(remoteFiles.map((f) => [f.relPath, f]));

  const allPaths = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const relPath of allPaths) {
    const local = localMap.get(relPath);
    const remote = remoteMap.get(relPath);

    if (!remote && local) {
      if (direction === 'download') { report.skipped++; continue; }
      report.synced.push({ direction: 'upload', rel_path: relPath, size: local.size, reason: 'new' });
      if (!dry_run) {
        try {
          const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
          const remoteDir = path.dirname(remoteFile);
          await ensureRemoteDir(sshManager, session.ssh, remoteDir);
          await sshManager.sftpUpload(session.ssh, path.join(resolvedLocal, relPath), remoteFile);
        } catch (err) {
          report.errors.push(`Upload failed ${relPath}: ${(err as Error).message}`);
        }
      }
      continue;
    }

    if (!local && remote) {
      if (direction === 'upload') { report.skipped++; continue; }
      report.synced.push({ direction: 'download', rel_path: relPath, size: remote.size, reason: 'new' });
      if (!dry_run) {
        try {
          const localFile = path.join(resolvedLocal, relPath);
          const localDir = path.dirname(localFile);
          if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
          const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
          await sshManager.sftpDownload(session.ssh, remoteFile, localFile);
        } catch (err) {
          report.errors.push(`Download failed ${relPath}: ${(err as Error).message}`);
        }
      }
      continue;
    }

    if (local && remote) {
      if (local.size === remote.size && local.mtime === remote.mtime) {
        report.skipped++;
        continue;
      }

      if (direction === 'upload') {
        report.synced.push({ direction: 'upload', rel_path: relPath, size: local.size, reason: 'updated' });
        if (!dry_run) {
          try {
            const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
            await sshManager.sftpUpload(session.ssh, path.join(resolvedLocal, relPath), remoteFile);
          } catch (err) {
            report.errors.push(`Upload failed ${relPath}: ${(err as Error).message}`);
          }
        }
      } else if (direction === 'download') {
        report.synced.push({ direction: 'download', rel_path: relPath, size: remote.size, reason: 'updated' });
        if (!dry_run) {
          try {
            const localFile = path.join(resolvedLocal, relPath);
            const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
            await sshManager.sftpDownload(session.ssh, remoteFile, localFile);
          } catch (err) {
            report.errors.push(`Download failed ${relPath}: ${(err as Error).message}`);
          }
        }
      } else {
        if (local.mtime >= remote.mtime) {
          report.synced.push({ direction: 'upload', rel_path: relPath, size: local.size, reason: 'newer' });
          if (!dry_run) {
            try {
              const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
              await sshManager.sftpUpload(session.ssh, path.join(resolvedLocal, relPath), remoteFile);
            } catch (err) {
              report.errors.push(`Upload failed ${relPath}: ${(err as Error).message}`);
            }
          }
        } else {
          report.synced.push({ direction: 'download', rel_path: relPath, size: remote.size, reason: 'newer' });
          if (!dry_run) {
            try {
              const localFile = path.join(resolvedLocal, relPath);
              const remoteFile = remote_path.endsWith('/') ? `${remote_path}${relPath}` : `${remote_path}/${relPath}`;
              await sshManager.sftpDownload(session.ssh, remoteFile, localFile);
            } catch (err) {
              report.errors.push(`Download failed ${relPath}: ${(err as Error).message}`);
            }
          }
        }
      }
    }
  }

  const uploaded = report.synced.filter((s) => s.direction === 'upload');
  const downloaded = report.synced.filter((s) => s.direction === 'download');
  const totalTransferred = [...uploaded, ...downloaded].reduce((sum, s) => sum + s.size, 0);

  logger.info({
    sessionId: session_id,
    synced: report.synced.length,
    skipped: report.skipped,
    uploaded: uploaded.length,
    downloaded: downloaded.length,
    totalSize: totalTransferred,
    dry_run,
    errors: report.errors.length,
  }, 'Sync complete');

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        ...report,
        summary: {
          total_synced: report.synced.length,
          uploaded: uploaded.length,
          downloaded: downloaded.length,
          skipped: report.skipped,
          total_bytes: totalTransferred,
          errors: report.errors.length,
        },
      }, null, 2),
    }],
    isError: report.errors.length > 0,
  };
}

async function ensureRemoteDir(sshManager: SSHManager, ssh: import('ssh2').Client, remotePath: string): Promise<void> {
  const parts = remotePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += '/' + part;
    try {
      const exists = await sshManager.sftpExists(ssh, current);
      if (!exists) {
        await sshManager.sftpMkdir(ssh, current);
      }
    } catch {
      try { await sshManager.sftpMkdir(ssh, current); } catch {}
    }
  }
}
