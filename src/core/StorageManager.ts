import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

export interface StoredSession {
  id: string;
  host: string;
  tmuxSession: string;
  shell?: string;
  connectedAt: number;
  lastActivity: number;
}

export class StorageManager {
  private storageDir: string;
  private filePath: string;
  private data: StoredSession[] = [];
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || path.join(os.homedir(), '.dynamic-ssh-mcp');
    this.filePath = path.join(this.storageDir, 'sessions.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.data = parsed;
          logger.info({ count: this.data.length, path: this.filePath }, 'Session storage loaded');
        }
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message, path: this.filePath }, 'Failed to load session storage, starting fresh');
      this.data = [];
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
      this.dirty = false;
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to flush session storage');
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 500);
  }

  save(session: StoredSession): void {
    const idx = this.data.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.data[idx] = session;
    } else {
      this.data.push(session);
    }
    this.markDirty();
  }

  remove(id: string): void {
    const idx = this.data.findIndex((s) => s.id === id);
    if (idx >= 0) {
      this.data.splice(idx, 1);
      this.markDirty();
    }
  }

  get(id: string): StoredSession | undefined {
    return this.data.find((s) => s.id === id);
  }

  list(): StoredSession[] {
    return [...this.data];
  }

  listByHost(host: string): StoredSession[] {
    return this.data.filter((s) => s.host === host);
  }

  listTmuxSessions(): string[] {
    return this.data.map((s) => s.tmuxSession);
  }

  shutdown(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flush();
  }
}
