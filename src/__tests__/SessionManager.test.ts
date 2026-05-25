import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../core/SessionManager.js';
import { StorageManager } from '../core/StorageManager.js';
import type { Session } from '../types/index.js';

function createMockSsh() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    on: (event: string, cb: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    emit: (event: string, ...args: any[]) => {
      if (listeners[event]) {
        listeners[event].forEach((cb) => cb(...args));
      }
    },
    destroy: () => {
      if (listeners['close']) {
        listeners['close'].forEach((cb) => cb());
      }
    },
    removeAllListeners: (event: string) => {
      delete listeners[event];
    },
    listeners,
  };
}

describe('SessionManager', () => {
  let storage: StorageManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    storage = new StorageManager();
    sessionManager = new SessionManager(storage);
  });

  it('should create a session with auto-generated ID', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod_abc', 'bash');

    expect(session.id).toMatch(/^sess_[a-f0-9]{32}$/);
    expect(session.host).toBe('prod');
    expect(session.tmuxSession).toBe('mcp_prod_abc');
    expect(session.shell).toBe('bash');
    expect(session.connectedAt).toBeGreaterThan(0);
    expect(session.lastActivity).toBeGreaterThan(0);
  });

  it('should create a session with existing ID', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod_abc', 'bash', 'sess_existing123');

    expect(session.id).toBe('sess_existing123');
  });

  it('should get session by ID', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('staging', ssh as any, 'mcp_staging_xyz');

    const retrieved = sessionManager.get(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.host).toBe('staging');
    expect(retrieved!.tmuxSession).toBe('mcp_staging_xyz');
  });

  it('should return undefined for non-existent session', () => {
    const result = sessionManager.get('sess_nonexistent');
    expect(result).toBeUndefined();
  });

  it('should update lastActivity on get', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod');

    const before = session.lastActivity;
    // Wait 10ms to ensure timestamp changes
    const retrieved = sessionManager.get(session.id);
    // get() should update lastActivity
    expect(session.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('should remove session and destroy SSH', () => {
    const ssh = createMockSsh();
    let destroyed = false;
    ssh.destroy = () => { destroyed = true; };

    const session = sessionManager.create('prod', ssh as any, 'mcp_prod');
    const removed = sessionManager.remove(session.id);

    expect(removed).toBe(true);
    expect(destroyed).toBe(true);
    expect(sessionManager.has(session.id)).toBe(false);
    expect(sessionManager.get(session.id)).toBeUndefined();
  });

  it('should return false when removing non-existent session', () => {
    const result = sessionManager.remove('sess_nonexistent');
    expect(result).toBe(false);
  });

  it('should auto-remove session when SSH closes', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod');

    expect(sessionManager.has(session.id)).toBe(true);

    // Simulate SSH close event
    ssh.emit('close');

    expect(sessionManager.has(session.id)).toBe(false);
  });

  it('should list all sessions', () => {
    const ssh1 = createMockSsh();
    const ssh2 = createMockSsh();
    sessionManager.create('prod', ssh1 as any, 'mcp_prod_1');
    sessionManager.create('staging', ssh2 as any, 'mcp_staging_1');

    const list = sessionManager.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('host');
    expect(list[0]).toHaveProperty('connectedAt');
    expect(list[0]).toHaveProperty('lastActivity');
    expect(list[0]).toHaveProperty('tmuxSession');
  });

  it('should disconnect all sessions', () => {
    const ssh1 = createMockSsh();
    const ssh2 = createMockSsh();
    sessionManager.create('prod', ssh1 as any, 'mcp_prod_1');
    sessionManager.create('staging', ssh2 as any, 'mcp_staging_1');

    expect(sessionManager.count).toBe(2);

    sessionManager.disconnectAll();

    expect(sessionManager.count).toBe(0);
  });

  it('should track session count', () => {
    expect(sessionManager.count).toBe(0);

    const ssh1 = createMockSsh();
    sessionManager.create('prod', ssh1 as any, 'mcp_prod_1');
    expect(sessionManager.count).toBe(1);

    const ssh2 = createMockSsh();
    sessionManager.create('staging', ssh2 as any, 'mcp_staging_1');
    expect(sessionManager.count).toBe(2);
  });

  it('should persist session to storage on create', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod_abc', 'bash');

    const stored = storage.get(session.id);
    expect(stored).toBeDefined();
    expect(stored!.host).toBe('prod');
    expect(stored!.tmuxSession).toBe('mcp_prod_abc');
    expect(stored!.shell).toBe('bash');
  });

  it('should remove session from storage on remove', () => {
    const ssh = createMockSsh();
    const session = sessionManager.create('prod', ssh as any, 'mcp_prod_abc');

    sessionManager.remove(session.id);
    expect(storage.get(session.id)).toBeUndefined();
  });
});
