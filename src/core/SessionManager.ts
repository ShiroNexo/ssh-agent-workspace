import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import type { Session } from '../types/index.js';

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(
    host: string,
    ssh: Session['ssh'],
    tmuxSession: string,
    shell?: string
  ): Session {
    const id = `sess_${uuidv4().replace(/-/g, '')}`;
    const session: Session = {
      id,
      host,
      ssh,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      tmuxSession,
      shell,
    };

    this.sessions.set(id, session);

    ssh.on('close', () => {
      logger.info({ sessionId: id, host }, 'SSH connection closed, removing session');
      this.sessions.delete(id);
    });

    ssh.on('error', (err) => {
      logger.error(
        { sessionId: id, error: err.message },
        'SSH connection error'
      );
    });

    logger.info({ sessionId: id, host, tmuxSession, shell }, 'Session created');
    return session;
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  remove(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    try {
      session.ssh.destroy();
    } catch (err) {
      logger.error(
        { sessionId: id, error: (err as Error).message },
        'Error destroying SSH connection'
      );
    }

    this.sessions.delete(id);
    logger.info({ sessionId: id }, 'Session removed');
    return true;
  }

  disconnectAll(): void {
    for (const [id, session] of this.sessions) {
      try {
        session.ssh.destroy();
      } catch (err) {
        logger.error(
          { sessionId: id, error: (err as Error).message },
          'Error destroying SSH connection during cleanup'
        );
      }
    }
    this.sessions.clear();
    logger.info('All sessions disconnected');
  }

  list(): Array<
    Pick<Session, 'id' | 'host' | 'connectedAt' | 'lastActivity' | 'tmuxSession' | 'shell'>
  > {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      host: s.host,
      connectedAt: s.connectedAt,
      lastActivity: s.lastActivity,
      tmuxSession: s.tmuxSession,
      shell: s.shell,
    }));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get count(): number {
    return this.sessions.size;
  }
}
