import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { TmuxManager, MCP_PROMPT } from '../core/TmuxManager.js';
import { isReadOnlyMode, isCommandDenied } from '../utils/security.js';
import { logger } from '../utils/logger.js';
import { stripAnsi } from '../utils/ansi.js';

export const groupExecSchema = z.object({
  session_ids: z.array(z.string().min(1)).min(1).max(20).describe('Array of session IDs to execute the command on'),
  command: z.string().min(1).describe('Command to execute on all sessions'),
  wait_ms: z.number().min(0).max(60000).default(200).describe('Minimum ms before prompt detection per session'),
  max_wait_ms: z.number().min(0).max(300000).default(10000).describe('Maximum ms to wait for prompt per session'),
  lines: z.number().min(1).max(10000).default(200).describe('Output lines per session'),
  parallel: z.boolean().default(true).describe('Run commands in parallel (true) or sequentially (false)'),
});

export const groupExecTool = {
  name: 'group_exec',
  description:
    'Execute the same command across multiple tmux sessions simultaneously or sequentially. Useful for managing clusters. Returns per-session results with host and exit status.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of session IDs to target',
      },
      command: { type: 'string', description: 'Command to execute' },
      wait_ms: { type: 'number', description: 'Min ms before prompt detection (default: 200)', default: 200 },
      max_wait_ms: { type: 'number', description: 'Max ms for prompt per session (default: 10000)', default: 10000 },
      lines: { type: 'number', description: 'Output lines per session (default: 200)', default: 200 },
      parallel: { type: 'boolean', description: 'Execute in parallel (default: true)', default: true },
    },
    required: ['session_ids', 'command'],
  },
};

function outputContainsPrompt(output: string): boolean {
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    return line.includes(MCP_PROMPT.trim());
  }
  return false;
}

function stripPrompts(output: string): string {
  const lines = output.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() === MCP_PROMPT.trim()) continue;
    if (line.trimEnd().endsWith(MCP_PROMPT.trim())) {
      cleaned.push(line.trimEnd().replace(MCP_PROMPT.trim(), '').trimEnd());
    } else {
      cleaned.push(line);
    }
  }
  return cleaned.join('\n').trimEnd();
}

async function executeOnSession(
  session_id: string,
  command: string,
  wait_ms: number,
  max_wait_ms: number,
  lines: number,
  sessionManager: SessionManager,
  tmuxManager: TmuxManager
): Promise<Record<string, unknown>> {
  const session = sessionManager.get(session_id);
  if (!session) {
    return { session_id, host: 'unknown', status: 'error', error: 'Session not found' };
  }

  if (isReadOnlyMode(session.host)) {
    return { session_id, host: session.host, status: 'error', error: `Host '${session.host}' is in read-only mode` };
  }

  try {
    await tmuxManager.sendCommand(session.ssh, session.tmuxSession, command);
  } catch (err) {
    return { session_id, host: session.host, status: 'error', error: `Send failed: ${(err as Error).message}` };
  }

  const pollInterval = 250;
  let elapsed = 0;

  if (wait_ms > 0) {
    await new Promise((r) => setTimeout(r, wait_ms));
    elapsed += wait_ms;
  }

  let output = '';
  let stabilized = false;

  while (elapsed < max_wait_ms) {
    try {
      output = await tmuxManager.capturePane(session.ssh, session.tmuxSession, lines);
      if (outputContainsPrompt(output)) {
        stabilized = true;
        break;
      }
    } catch { /* retry */ }

    await new Promise((r) => setTimeout(r, pollInterval));
    elapsed += pollInterval;
  }

  const cleaned = stripAnsi(stripPrompts(output));
  return {
    session_id,
    host: session.host,
    status: stabilized ? 'success' : 'timeout',
    output: cleaned,
    stabilized,
  };
}

export async function handleGroupExec(
  args: unknown,
  sessionManager: SessionManager,
  tmuxManager: TmuxManager
) {
  const parsed = groupExecSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: 'text' as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  }

  const { session_ids, command, wait_ms, max_wait_ms, lines, parallel } = parsed.data;

  if (isCommandDenied(command)) {
    return {
      content: [{ type: 'text' as const, text: `Error: Command '${command}' is denied by security policy` }],
      isError: true,
    };
  }

  const uniqueIds = [...new Set(session_ids)];
  const missing = uniqueIds.filter((id) => !sessionManager.has(id));
  if (missing.length > 0) {
    return {
      content: [{ type: 'text' as const, text: `Error: Sessions not found: ${missing.join(', ')}` }],
      isError: true,
    };
  }

  let results: Record<string, unknown>[];

  if (parallel) {
    results = await Promise.all(
      uniqueIds.map((id) =>
        executeOnSession(id, command, wait_ms, max_wait_ms, lines, sessionManager, tmuxManager)
      )
    );
  } else {
    results = [];
    for (const id of uniqueIds) {
      results.push(
        await executeOnSession(id, command, wait_ms, max_wait_ms, lines, sessionManager, tmuxManager)
      );
    }
  }

  const succeeded = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'error').length;
  const timedOut = results.filter((r) => r.status === 'timeout').length;

  logger.info({ command, sessions: uniqueIds.length, succeeded, failed, timedOut }, 'Group exec complete');

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        command,
        sessions_targeted: uniqueIds.length,
        succeeded,
        failed,
        timed_out: timedOut,
        results,
      }, null, 2),
    }],
  };
}
