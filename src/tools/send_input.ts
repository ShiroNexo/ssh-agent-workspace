import { z } from 'zod';
import { SessionManager } from '../core/SessionManager.js';
import { TmuxManager } from '../core/TmuxManager.js';
import { isReadOnlyMode } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export const sendInputSchema = z.object({
  session_id: z.string().min(1),
  input: z.string(),
});

export const sendInputTool = {
  name: 'send_input',
  description:
    'Send raw input into a persistent tmux session. Preserves shell state (cwd, env, history). Non-blocking.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      session_id: {
        type: 'string',
        description: 'Session ID returned by connect',
      },
      input: {
        type: 'string',
        description: 'Raw input text to send to the tmux pane',
      },
    },
    required: ['session_id', 'input'],
  },
};

export async function handleSendInput(
  args: unknown,
  sessionManager: SessionManager,
  tmuxManager: TmuxManager
) {
  if (isReadOnlyMode()) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Server is in read-only mode. Input sending is disabled.',
        },
      ],
      isError: true,
    };
  }

  const parsed = sendInputSchema.safeParse(args);
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

  const { session_id, input } = parsed.data;
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
    await tmuxManager.sendInput(session.ssh, session.tmuxSession, input);
    logger.info({ sessionId: session_id, inputLength: input.length }, 'Input sent');
    return {
      content: [{ type: 'text' as const, text: 'Input sent successfully' }],
    };
  } catch (err) {
    logger.error(
      { sessionId: session_id, error: (err as Error).message },
      'Failed to send input'
    );
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: Failed to send input: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
