import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isReadOnlyMode, isHostAllowed, isCommandDenied } from '../utils/security.js';

describe('security', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('isReadOnlyMode', () => {
    it('should return false by default', () => {
      delete process.env.MCP_SSH_READONLY;
      expect(isReadOnlyMode()).toBe(false);
    });

    it('should return true when MCP_SSH_READONLY=true', () => {
      process.env.MCP_SSH_READONLY = 'true';
      expect(isReadOnlyMode()).toBe(true);
    });

    it('should return false for any other value', () => {
      process.env.MCP_SSH_READONLY = 'false';
      expect(isReadOnlyMode()).toBe(false);

      process.env.MCP_SSH_READONLY = '1';
      expect(isReadOnlyMode()).toBe(false);
    });
  });

  describe('isHostAllowed', () => {
    it('should allow all hosts when no filter set', () => {
      delete process.env.MCP_SSH_ALLOWED_HOSTS;
      expect(isHostAllowed('prod')).toBe(true);
      expect(isHostAllowed('any-host')).toBe(true);
    });

    it('should allow only listed hosts', () => {
      process.env.MCP_SSH_ALLOWED_HOSTS = 'prod,staging';
      expect(isHostAllowed('prod')).toBe(true);
      expect(isHostAllowed('staging')).toBe(true);
      expect(isHostAllowed('gpu')).toBe(false);
    });

    it('should trim whitespace from host entries', () => {
      process.env.MCP_SSH_ALLOWED_HOSTS = ' prod , staging ';
      expect(isHostAllowed('prod')).toBe(true);
      expect(isHostAllowed('staging')).toBe(true);
    });

    it('should handle empty list as allow all', () => {
      process.env.MCP_SSH_ALLOWED_HOSTS = '';
      expect(isHostAllowed('prod')).toBe(true);
    });

    it('should handle comma-only list', () => {
      process.env.MCP_SSH_ALLOWED_HOSTS = ',';
      expect(isHostAllowed('prod')).toBe(true);
    });
  });

  describe('isCommandDenied', () => {
    it('should allow all commands when no denylist', () => {
      delete process.env.MCP_SSH_DENYLIST_COMMANDS;
      expect(isCommandDenied('rm -rf /')).toBe(false);
      expect(isCommandDenied('ls -la')).toBe(false);
    });

    it('should block denied command patterns', () => {
      process.env.MCP_SSH_DENYLIST_COMMANDS = 'rm -rf,shutdown,halt';
      expect(isCommandDenied('rm -rf /')).toBe(true);
      expect(isCommandDenied('shutdown now')).toBe(true);
      expect(isCommandDenied('sudo halt')).toBe(true);
    });

    it('should be case-insensitive', () => {
      process.env.MCP_SSH_DENYLIST_COMMANDS = 'RM -RF,ShutDown';
      expect(isCommandDenied('rm -rf /')).toBe(true);
      expect(isCommandDenied('SHUTDOWN now')).toBe(true);
    });

    it('should allow safe commands', () => {
      process.env.MCP_SSH_DENYLIST_COMMANDS = 'rm -rf,shutdown';
      expect(isCommandDenied('ls -la')).toBe(false);
      expect(isCommandDenied('echo hello')).toBe(false);
      expect(isCommandDenied('npm run build')).toBe(false);
    });

    it('should handle empty denylist', () => {
      process.env.MCP_SSH_DENYLIST_COMMANDS = '';
      expect(isCommandDenied('rm -rf /')).toBe(false);
    });

    it('should trim whitespace from entries', () => {
      process.env.MCP_SSH_DENYLIST_COMMANDS = ' rm -rf , shutdown ';
      expect(isCommandDenied('rm -rf /')).toBe(true);
      expect(isCommandDenied('shutdown -h now')).toBe(true);
    });
  });
});
