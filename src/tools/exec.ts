import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { TmuxManager, MCP_PROMPT } from '../core/TmuxManager.js';
import { isReadOnlyMode, isCommandDenied } from '../utils/security.js';
import { logger } from '../utils/logger.js';
import { stripAnsi } from '../utils/ansi.js';

export const execSchema = z.object({
  session_id: z.string().min(1),
  command: z.string().min(1),
  wait_ms: z
    .number()
    .min(0)
    .max(60000)
    .default(200)
    .describe('Minimum milliseconds to wait before starting prompt detection'),
  max_wait_ms: z
    .number()
    .min(0)
    .max(300000)
    .default(10000)
    .describe('Maximum total milliseconds to wait for prompt stabilization'),
  lines: z
    .number()
    .min(1)
    .max(10000)
    .default(200)
    .describe('Number of output lines to capture'),
});

export const execTool = {
  name: 'exec',
  description:
    'Execute a command in a persistent tmux session with prompt stabilization. Sends the command, waits for the deterministic prompt to appear, then captures output.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
      command: {
        type: 'string',
        description: 'Command to execute',
      },
      wait_ms: {
        type: 'number',
        description:
          'Minimum milliseconds to wait before starting prompt detection (default: 200)',
        default: 200,
      },
      max_wait_ms: {
        type: 'number',
        description:
          'Maximum total milliseconds to wait for prompt stabilization (default: 10000)',
        default: 10000,
      },
      lines: {
        type: 'number',
        description: 'Number of output lines to capture (default: 200)',
        default: 200,
      },
    },
    required: ['session_id', 'command'],
  },
};

function outputContainsPrompt(output: string): boolean {
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    // The prompt should be at the very end of the last non-empty line
    return line.includes(MCP_PROMPT.trim());
  }
  return false;
}

function stripPrompts(output: string): string {
  const lines = output.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() === MCP_PROMPT.trim()) {
      continue;
    }
    if (line.trimEnd().endsWith(MCP_PROMPT.trim())) {
      cleaned.push(line.trimEnd().replace(MCP_PROMPT.trim(), '').trimEnd());
    } else {
      cleaned.push(line);
    }
  }
  return cleaned.join('\n').trimEnd();
}

export async function handleExec(
  args: unknown,
  sessionManager: SessionManager,
  tmuxManager: TmuxManager
) {
  if (isReadOnlyMode()) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Server is in read-only mode. Command execution is disabled.',
        },
      ],
      isError: true,
    };
  }

  const parsed = execSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Invalid arguments: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const { session_id, command, wait_ms, max_wait_ms, lines } = parsed.data;

  if (isCommandDenied(command)) {
    logger.warn({ sessionId: session_id, command }, 'Command rejected by denylist');
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Command '${command}' is denied by security policy`,
        },
      ],
      isError: true,
    };
  }

  const session = sessionManager.get(session_id);
  if (!session) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Session '${session_id}' not found or has been disconnected`,
        },
      ],
      isError: true,
    };
  }

  try {
    await tmuxManager.sendCommand(session.ssh, session.tmuxSession, command);
    logger.info({ sessionId: session_id, command }, 'Command sent');
  } catch (err) {
    logger.error(
      { sessionId: session_id, error: (err as Error).message },
      'Failed to send command'
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Failed to send command: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // Prompt stabilization
  const pollInterval = 250;
  let elapsed = 0;

  if (wait_ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait_ms));
    elapsed += wait_ms;
  }

  let output = '';
  let stabilized = false;

  while (elapsed < max_wait_ms) {
    try {
      output = await tmuxManager.capturePane(
        session.ssh,
        session.tmuxSession,
        lines
      );
    } catch (err) {
      logger.error(
        { sessionId: session_id, error: (err as Error).message },
        'Failed to capture output during stabilization'
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Failed to capture output: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }

    if (outputContainsPrompt(output)) {
      stabilized = true;
      logger.info(
        { sessionId: session_id, elapsedMs: elapsed },
        'Prompt stabilized'
      );
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
  }

  if (!stabilized) {
    logger.warn(
      { sessionId: session_id, max_wait_ms },
      'Prompt did not stabilize within max_wait_ms; returning current output'
    );
  }

  const cleanedOutput = stripPrompts(output);
  const sanitizedOutput = stripAnsi(cleanedOutput);

  return {
    content: [{ type: 'text' as const, text: sanitizedOutput }],
  };
}
