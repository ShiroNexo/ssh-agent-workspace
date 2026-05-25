import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../utils/ansi.js';

describe('ansi', () => {
  describe('stripAnsi', () => {
    it('should return plain text unchanged', () => {
      expect(stripAnsi('hello world')).toBe('hello world');
      expect(stripAnsi('no colors here')).toBe('no colors here');
    });

    it('should strip color codes', () => {
      expect(stripAnsi('\u001B[31mred\u001B[0m')).toBe('red');
      expect(stripAnsi('\u001B[32mgreen\u001B[0m')).toBe('green');
      expect(stripAnsi('\u001B[1;31mbold red\u001B[0m')).toBe('bold red');
    });

    it('should strip cursor control sequences', () => {
      expect(stripAnsi('\u001B[1Aup\u001B[1Bdown')).toBe('updown');
      expect(stripAnsi('\u001B[2Jcleared')).toBe('cleared');
    });

    it('should strip complex multi-code sequences', () => {
      const input = '\u001B[1m\u001B[33m\u001B[44mstyled\u001B[0m text';
      expect(stripAnsi(input)).toBe('styled text');
    });

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('should handle string with only ANSI codes', () => {
      expect(stripAnsi('\u001B[31m\u001B[0m')).toBe('');
    });

    it('should strip more escape patterns with updated regex', () => {
      // New comprehensive regex strips ESC followed by valid CSI terminator chars
      // 't' falls in the R-T range used as CSI terminators
      const input = 'text \u001B[31mred\u001B[0m normal';
      expect(stripAnsi(input)).toBe('text red normal');
    });

    it('should strip prompt-style ANSI sequences', () => {
      // Typical colored prompt
      const input = '\u001B[01;32muser@host\u001B[00m:\u001B[01;34m~$\u001B[00m ';
      expect(stripAnsi(input)).toBe('user@host:~$ ');
    });
  });
});
