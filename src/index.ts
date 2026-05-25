#!/usr/bin/env node
import { createServer } from './server.js';
import { StorageManager } from './core/StorageManager.js';
import { SSHManager } from './core/SSHManager.js';
import { TmuxManager, MCP_PROMPT } from './core/TmuxManager.js';
import { listHostAliases, getHostConfig } from './utils/sshConfig.js';
import { buildSshConfig } from './utils/ssh.js';
import { isHostAllowed } from './utils/security.js';
import { logger } from './utils/logger.js';

const RESTORE_ENABLED = process.env.MCP_SSH_RESTORE_SESSIONS !== 'false';

async function restoreSessions(
  storage: StorageManager,
  sshManager: SSHManager,
  tmuxManager: TmuxManager,
  sessionManager: ReturnType<typeof createServer>['sessionManager']
): Promise<number> {
  if (!RESTORE_ENABLED) {
    logger.info('Session restore disabled (MCP_SSH_RESTORE_SESSIONS=false)');
    return 0;
  }

  // Strategy 1: Restore from persistent storage (known sessions from last run)
  const storedSessions = storage.list();
  const hosts = [...new Set(storedSessions.map((s) => s.host))];
  // Also scan all configured hosts in case storage is empty or incomplete
  const allAliases = listHostAliases();
  for (const alias of allAliases) {
    if (!hosts.includes(alias) && isHostAllowed(alias)) {
      hosts.push(alias);
    }
  }

  if (hosts.length === 0) {
    logger.debug('No hosts to restore');
    return 0;
  }

  logger.info({ hosts }, 'Attempting session restore');

  let restored = 0;
  const knownTmuxSessions = new Set(storage.listTmuxSessions());

  for (const host of hosts) {
    if (!isHostAllowed(host)) continue;

    const hostConfig = getHostConfig(host);
    if (!hostConfig) {
      logger.debug({ host }, 'Skip restore: no SSH config');
      continue;
    }

    const baseSshConfig = buildSshConfig(hostConfig, 15000);
    if (!baseSshConfig) {
      logger.warn({ host }, 'Skip restore: failed to build SSH config');
      continue;
    }

    // First, connect temporarily to discover mcp_* tmux sessions
    let probeSsh;
    try {
      probeSsh = await sshManager.connect({ ...baseSshConfig });
    } catch (err) {
      logger.warn({ host, error: (err as Error).message }, 'Restore: SSH probe failed');
      continue;
    }

    const tmuxInstalled = await tmuxManager.isInstalled(probeSsh);
    if (!tmuxInstalled) {
      sshManager.disconnect(probeSsh);
      logger.debug({ host }, 'Restore: tmux not installed, skipping');
      continue;
    }

    let tmuxSessions: string[] = [];
    try {
      tmuxSessions = await tmuxManager.listSessions(probeSsh);
    } catch (err) {
      sshManager.disconnect(probeSsh);
      logger.warn({ host, error: (err as Error).message }, 'Restore: list sessions failed');
      continue;
    }

    // Filter for MCP-managed sessions (mcp_ prefix)
    const mcpSessions = tmuxSessions.filter((s) => s.startsWith('mcp_'));
    sshManager.disconnect(probeSsh);

    if (mcpSessions.length === 0) {
      logger.debug({ host }, 'Restore: no mcp_* tmux sessions found');
      continue;
    }

    // Reconnect to each MCP tmux session with its own SSH connection
    for (const tmuxSession of mcpSessions) {
      const storedSession = storedSessions.find(
        (s) => s.host === host && s.tmuxSession === tmuxSession
      );

      // Each restored session gets its own SSH connection
      let ssh;
      try {
        ssh = await sshManager.connect({ ...baseSshConfig });
      } catch (err) {
        logger.warn({ host, tmuxSession, error: (err as Error).message }, 'Restore: SSH session connect failed');
        continue;
      }

      try {
        const exists = await tmuxManager.hasSession(ssh, tmuxSession);
        if (!exists) {
          sshManager.disconnect(ssh);
          if (storedSession) storage.remove(storedSession.id);
          continue;
        }

        // Check and inject prompt if missing
        try {
          const output = await tmuxManager.capturePane(ssh, tmuxSession, 5);
          if (!output.includes(MCP_PROMPT)) {
            await tmuxManager.injectPrompt(ssh, tmuxSession);
            await new Promise((r) => setTimeout(r, 300));
          }
        } catch {
          logger.warn({ host, tmuxSession }, 'Restore: prompt check failed, continuing');
        }

        const session = sessionManager.create(
          host,
          ssh,
          tmuxSession,
          storedSession?.shell,
          storedSession?.id
        );

        logger.info({ sessionId: session.id, host, tmuxSession }, 'Session restored');
        restored++;
        knownTmuxSessions.add(tmuxSession);
      } catch (err) {
        sshManager.disconnect(ssh);
        logger.warn({ host, tmuxSession, error: (err as Error).message }, 'Restore: session skipped');
      }
    }
  }

  // Clean up stale storage entries for sessions that no longer exist
  for (const stored of storedSessions) {
    if (!knownTmuxSessions.has(stored.tmuxSession)) {
      storage.remove(stored.id);
      logger.debug({ sessionId: stored.id, tmuxSession: stored.tmuxSession }, 'Cleaned up stale session record');
    }
  }

  logger.info({ restored }, 'Session restore complete');
  return restored;
}

async function main() {
  const storage = new StorageManager();
  const { server, sessionManager, transport } = createServer(storage);
  const sshManager = new SSHManager();
  const tmuxManager = new TmuxManager(sshManager);

  // Prevent silent crashes from unhandled errors
  process.on('uncaughtException', (err) => {
    logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ error: (reason as Error)?.message || String(reason) }, 'Unhandled rejection');
  });

  // Restore previous sessions on startup (fire-and-forget, doesn't block MCP)
  restoreSessions(storage, sshManager, tmuxManager, sessionManager).catch((err) => {
    logger.error({ error: err.message }, 'Session restore failed');
  });

  // Graceful shutdown
  const cleanup = () => {
    logger.info('Shutting down...');
    sessionManager.disconnectAll();
    storage.shutdown();
    server
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await server.connect(transport);
  logger.info('Dynamic SSH MCP server running on stdio');
}

main().catch((err) => {
  logger.error({ error: err.message }, 'Fatal error');
  process.exit(1);
});
