import { describe, it, expect } from 'vitest';
import { sanitizeTmuxSessionName } from '../utils/validation.js';

describe('validation', () => {
  describe('sanitizeTmuxSessionName', () => {
    it('should preserve valid names unchanged', () => {
      expect(sanitizeTmuxSessionName('prod')).toBe('prod');
      expect(sanitizeTmuxSessionName('my_host')).toBe('my_host');
      expect(sanitizeTmuxSessionName('server-01')).toBe('server-01');
      expect(sanitizeTmuxSessionName('test.example')).toBe('test.example');
    });

    it('should replace invalid characters with underscore', () => {
      expect(sanitizeTmuxSessionName('hello world')).toBe('hello_world');
      expect(sanitizeTmuxSessionName('host@domain')).toBe('host_domain');
      expect(sanitizeTmuxSessionName('path/name')).toBe('path_name');
    });

    it('should prefix non-alpha starters', () => {
      expect(sanitizeTmuxSessionName('123abc')).toBe('mcp_123abc');
      expect(sanitizeTmuxSessionName('-test')).toBe('mcp_-test');
      expect(sanitizeTmuxSessionName('.hidden')).toBe('mcp_.hidden');
    });
  });
});
