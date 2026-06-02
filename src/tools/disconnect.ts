import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { TmuxManager } from "../core/TmuxManager.js";
import { logger } from "../utils/logger.js";

export const disconnectSchema = z.object({
    session_id: z.string().min(1),
    preserve_tmux: z.boolean().default(true).describe("If false, the remote tmux session will be killed"),
});

export const disconnectTool = {
    name: "disconnect",
    description:
        "Disconnect from a session. Optionally kills the remote tmux session or leaves it running for reconnection.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: {
                type: "string",
                description: "Session ID returned by connect",
            },
            preserve_tmux: {
                type: "boolean",
                description: "Keep the tmux session running on the remote host (default: true)",
                default: true,
            },
        },
        required: ["session_id"],
    },
};

export async function handleDisconnect(args: unknown, sessionManager: SessionManager, tmuxManager: TmuxManager) {
    const parsed = disconnectSchema.safeParse(args);
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

    const { session_id, preserve_tmux } = parsed.data;
    const session = sessionManager.get(session_id);

    if (!session) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Session '${session_id}' not found or has already been disconnected`,
                },
            ],
            isError: true,
        };
    }

    if (!preserve_tmux) {
        try {
            await tmuxManager.killSession(session.ssh, session.tmuxSession);
        } catch (err) {
            logger.warn(
                { sessionId: session_id, error: (err as Error).message },
                "Failed to kill tmux session during disconnect",
            );
        }
    }

    const removed = sessionManager.remove(session_id);

    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(
                    {
                        status: removed ? "disconnected" : "not_found",
                        session_id,
                        preserve_tmux,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
