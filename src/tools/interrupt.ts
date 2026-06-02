import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { TmuxManager } from "../core/TmuxManager.js";
import { logger } from "../utils/logger.js";

export const interruptSchema = z.object({
    session_id: z.string().min(1),
    signal: z.enum(["SIGINT", "SIGTERM"]).default("SIGINT"),
});

export const interruptTool = {
    name: "interrupt",
    description:
        "Send an interrupt signal (Ctrl-C) or termination signal (Ctrl-D) to the active process in a tmux session. Useful for stopping long-running commands.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: {
                type: "string",
                description: "Session ID returned by connect",
            },
            signal: {
                type: "string",
                description: "Signal to send: SIGINT (Ctrl-C) or SIGTERM (Ctrl-D)",
                enum: ["SIGINT", "SIGTERM"],
                default: "SIGINT",
            },
        },
        required: ["session_id"],
    },
};

export async function handleInterrupt(args: unknown, sessionManager: SessionManager, tmuxManager: TmuxManager) {
    const parsed = interruptSchema.safeParse(args);
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

    const { session_id, signal } = parsed.data;
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
        await tmuxManager.sendSignal(session.ssh, session.tmuxSession, signal);
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Signal ${signal} sent successfully`,
                },
            ],
        };
    } catch (err) {
        logger.error(
            { sessionId: session_id, signal, error: (err as Error).message },
            "Failed to send interrupt signal",
        );
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Failed to send signal: ${(err as Error).message}`,
                },
            ],
            isError: true,
        };
    }
}
