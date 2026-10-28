import { spawn } from "node:child_process";
import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { isReadOnlyMode } from "../utils/security.js";

export const openTerminalSchema = z.object({
    session_id: z.string().min(1),
});

export const openTerminalTool = {
    name: "open_terminal",
    description:
        "Open a local interactive terminal attached to the session's tmux pane. Use it for sudo -v or any password prompt: input stays in the terminal and is never sent to the agent. Do not run exec while the terminal is attached.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: { type: "string", description: "Session ID returned by connect" },
        },
        required: ["session_id"],
    },
};

export async function handleOpenTerminal(args: unknown, sessionManager: SessionManager) {
    const parsed = openTerminalSchema.safeParse(args);
    if (!parsed.success) {
        return { content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
    }

    const session = sessionManager.get(parsed.data.session_id);
    if (!session) {
        return {
            content: [{ type: "text" as const, text: `Error: Session '${parsed.data.session_id}' not found or has been disconnected` }],
            isError: true,
        };
    }
    if (isReadOnlyMode(session.host)) {
        return {
            content: [{ type: "text" as const, text: `Error: Host '${session.host}' is in read-only mode. Terminal access is disabled.` }],
            isError: true,
        };
    }
    if (process.platform !== "win32") {
        return {
            content: [{ type: "text" as const, text: "Error: open_terminal currently supports Windows only." }],
            isError: true,
        };
    }

    // The SSH values are process arguments, not PowerShell source, so config aliases cannot inject local commands.
    const terminal = spawn(
        "powershell.exe",
        [
            "-NoExit",
            "-Command",
            "& ssh.exe -tt -- $args[0] tmux attach-session -t $args[1]",
            session.host,
            session.tmuxSession,
        ],
        { detached: true, stdio: "ignore", windowsHide: false },
    );
    terminal.unref();

    return {
        content: [
            {
                type: "text" as const,
                text: "Interactive terminal opened. Run `sudo -v` there and type the password directly. When it succeeds, detach with Ctrl+B then D; the agent can then continue using exec.",
            },
        ],
    };
}
