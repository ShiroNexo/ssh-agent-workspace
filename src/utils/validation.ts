import { z } from 'zod';

export const sessionIdSchema = z.string().regex(/^sess_[a-f0-9]{32}$/);

export function sanitizeTmuxSessionName(name: string): string {
  // tmux session names can contain: letters, digits, underscore, hyphen, dot
  let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  // Must not start with a hyphen or dot, and should start with a letter for safety
  if (/^[^a-zA-Z]/.test(sanitized)) {
    sanitized = 'mcp_' + sanitized;
  }
  return sanitized;
}
