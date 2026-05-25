import { logger } from './logger.js';

export function isReadOnlyMode(): boolean {
  return process.env.MCP_SSH_READONLY === 'true';
}

export function isHostAllowed(host: string): boolean {
  const allowed = process.env.MCP_SSH_ALLOWED_HOSTS;
  if (!allowed) return true;
  const list = allowed
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  return list.includes(host);
}

export function isCommandDenied(command: string): boolean {
  const denylist = process.env.MCP_SSH_DENYLIST_COMMANDS;
  if (!denylist) return false;
  const list = denylist
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (list.length === 0) return false;
  const lower = command.toLowerCase();
  return list.some((denied) => lower.includes(denied.toLowerCase()));
}
