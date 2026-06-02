import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { SSHManager } from "../core/SSHManager.js";
import { logger } from "../utils/logger.js";

export const tailLogSchema = z.object({
    session_id: z.string().min(1),
    file_path: z.string().min(1).describe("Absolute path to the log file on the remote host"),
    lines: z.number().min(1).max(5000).default(100).describe("Number of lines to fetch (default: 100)"),
    follow_ms: z
        .number()
        .min(0)
        .max(30000)
        .default(0)
        .describe("If >0, poll for new lines this many milliseconds and return appended output"),
});

export const tailLogTool = {
    name: "tail_log",
    description:
        "Read the last N lines of a remote log file via SSH exec channel. Optionally follow (poll) for new output.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: {
                type: "string",
                description: "Session ID returned by connect",
            },
            file_path: {
                type: "string",
                description: "Absolute path to the log file on the remote host",
            },
            lines: {
                type: "number",
                description: "Number of lines to fetch from the end (default: 100, max: 5000)",
                default: 100,
            },
            follow_ms: {
                type: "number",
                description: "Milliseconds to poll for new output after initial fetch (0 = no follow, max: 30000)",
                default: 0,
            },
        },
        required: ["session_id", "file_path"],
    },
};

export async function handleTailLog(args: unknown, sessionManager: SessionManager, sshManager: SSHManager) {
    const parsed = tailLogSchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
        };
    }

    const { session_id, file_path, lines, follow_ms } = parsed.data;
    const session = sessionManager.get(session_id);

    if (!session) {
        return {
            content: [
                { type: "text" as const, text: `Error: Session '${session_id}' not found or has been disconnected` },
            ],
            isError: true,
        };
    }

    if (!sshManager.isAlive(session.ssh)) {
        return {
            content: [{ type: "text" as const, text: `Error: SSH connection for session '${session_id}' is dead` }],
            isError: true,
        };
    }

    try {
        const tailCmd = `tail -n ${lines} '${file_path.replace(/'/g, "'\\''")}' 2>&1`;
        const initial = await sshManager.exec(session.ssh, tailCmd, 10000);

        if (initial.code !== 0 && !initial.stdout) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Error: Failed to read '${file_path}': ${initial.stderr || initial.stdout || "unknown error"}`,
                    },
                ],
                isError: true,
            };
        }

        let output = initial.stdout;

        if (follow_ms > 0) {
            const pollInterval = 500;
            let elapsed = 0;

            while (elapsed < follow_ms) {
                await new Promise((r) => setTimeout(r, pollInterval));
                elapsed += pollInterval;
                try {
                    const next = await sshManager.exec(session.ssh, tailCmd, 5000);
                    if (next.stdout && next.stdout !== output) {
                        const prevLen = output.length;
                        if (next.stdout.length > prevLen && next.stdout.endsWith(output.slice(-200))) {
                            output = next.stdout;
                        } else if (next.stdout !== output) {
                            const diff = next.stdout.slice(
                                Math.max(0, next.stdout.length - (next.stdout.length - prevLen + 2000)),
                            );
                            if (diff.length > output.length) {
                                output = diff;
                            } else if (next.stdout.length > output.length) {
                                output = next.stdout.slice(-Math.max(lines * 2, output.length + 2000));
                            }
                        }
                    }
                } catch {
                    logger.warn({ sessionId: session_id, file_path }, "Follow poll failed, continuing");
                }
            }
        }

        logger.info({ sessionId: session_id, file_path, lines, outputLength: output.length }, "Log tailed");

        return {
            content: [{ type: "text" as const, text: output }],
        };
    } catch (err) {
        logger.error({ sessionId: session_id, file_path, error: (err as Error).message }, "Tail log failed");
        return {
            content: [{ type: "text" as const, text: `Error: Tail log failed: ${(err as Error).message}` }],
            isError: true,
        };
    }
}
