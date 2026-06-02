import { SessionManager } from "../core/SessionManager.js";

export const listSessionsTool = {
    name: "list_sessions",
    description:
        "List all active MCP SSH sessions with their host, connection time, last activity, and tmux session name",
    inputSchema: {
        type: "object" as const,
        properties: {},
    },
};

export async function handleListSessions(sessionManager: SessionManager) {
    const sessions = sessionManager.list();
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify({ sessions }, null, 2),
            },
        ],
    };
}
