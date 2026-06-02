import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { TmuxManager } from "../core/TmuxManager.js";
import { logger } from "../utils/logger.js";
import { stripAnsi } from "../utils/ansi.js";

export const readOutputSchema = z.object({
    session_id: z.string().min(1),
    lines: z.number().min(1).max(10000).default(200),
});

export const readOutputTool = {
    name: "read_output",
    description: "Capture the latest output from a tmux session pane. Returns recent terminal contents.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: {
                type: "string",
                description: "Session ID returned by connect",
            },
            lines: {
                type: "number",
                description: "Number of lines to capture from the end (default: 200, max: 10000)",
                default: 200,
            },
        },
        required: ["session_id"],
    },
};

export async function handleReadOutput(args: unknown, sessionManager: SessionManager, tmuxManager: TmuxManager) {
    const parsed = readOutputSchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Invalid arguments: ${parsed.error.message}`,
                },
            ],
            isError: true,
        };
    }

    const { session_id, lines } = parsed.data;
    const session = sessionManager.get(session_id);

    if (!session) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Session '${session_id}' not found or has been disconnected`,
                },
            ],
            isError: true,
        };
    }

    try {
        const output = await tmuxManager.capturePane(session.ssh, session.tmuxSession, lines);
        logger.info({ sessionId: session_id, lines, outputLength: output.length }, "Output captured");
        return {
            content: [{ type: "text" as const, text: stripAnsi(output) }],
        };
    } catch (err) {
        logger.error({ sessionId: session_id, error: (err as Error).message }, "Failed to read output");
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Failed to read output: ${(err as Error).message}`,
                },
            ],
            isError: true,
        };
    }
}
