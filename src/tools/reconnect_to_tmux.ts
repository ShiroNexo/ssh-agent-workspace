import { z } from "zod";
import { SessionManager } from "../core/SessionManager.js";
import { SSHManager } from "../core/SSHManager.js";
import { TmuxManager, MCP_PROMPT } from "../core/TmuxManager.js";
import { listHostAliases, getHostConfig } from "../utils/sshConfig.js";
import { buildSshConfig } from "../utils/ssh.js";
import { isHostAllowed } from "../utils/security.js";
import { logger } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export const reconnectSchema = z.object({
    host: z.string().min(1).describe("SSH host alias from ~/.ssh/config"),
    tmux_session: z.string().min(1).describe("Name of the existing tmux session on the remote host"),
    proxy_jump: z.string().min(1).optional().describe("SSH host alias of the bastion/jump host"),
});

export const reconnectTool = {
    name: "reconnect_to_tmux",
    description:
        "Reconnect to an existing tmux session on a remote host. Useful for recovery after MCP restarts or SSH disconnections.",
    inputSchema: {
        type: "object" as const,
        properties: {
            host: {
                type: "string",
                description: "SSH host alias from ~/.ssh/config",
            },
            tmux_session: {
                type: "string",
                description: "Name of the existing tmux session on the remote host",
            },
            proxy_jump: {
                type: "string",
                description: "Optional SSH host alias of a bastion/jump host",
            },
        },
        required: ["host", "tmux_session"],
    },
};

export async function handleReconnect(
    args: unknown,
    sessionManager: SessionManager,
    sshManager: SSHManager,
    tmuxManager: TmuxManager,
) {
    const parsed = reconnectSchema.safeParse(args);
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

    const { host, tmux_session } = parsed.data;

    if (!isHostAllowed(host)) {
        logger.warn({ host }, "Host rejected by allowlist");
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Host '${host}' is not in the allowed hosts list`,
                },
            ],
            isError: true,
        };
    }

    const aliases = listHostAliases();
    if (!aliases.includes(host)) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Host alias '${host}' not found in SSH config.\nAvailable aliases: ${aliases.join(", ") || "(none)"}`,
                },
            ],
            isError: true,
        };
    }

    const hostConfig = getHostConfig(host);
    if (!hostConfig) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Failed to resolve SSH configuration for '${host}'`,
                },
            ],
            isError: true,
        };
    }

    const proxyJumpAlias = parsed.data.proxy_jump || hostConfig.proxyJump;

    const sshConfig = buildSshConfig(hostConfig);
    if (!sshConfig) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Failed to read SSH private key for '${host}'`,
                },
            ],
            isError: true,
        };
    }

    let ssh;
    try {
        if (proxyJumpAlias) {
            if (!isHostAllowed(proxyJumpAlias)) {
                return {
                    content: [{ type: "text" as const, text: `Error: Proxy host '${proxyJumpAlias}' is not allowed` }],
                    isError: true,
                };
            }
            const proxyConfig = getHostConfig(proxyJumpAlias);
            if (!proxyConfig) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Error: Failed to resolve SSH config for proxy '${proxyJumpAlias}'`,
                        },
                    ],
                    isError: true,
                };
            }
            const proxySshConfig = buildSshConfig(proxyConfig);
            if (!proxySshConfig) {
                return {
                    content: [
                        { type: "text" as const, text: `Error: Failed to read SSH key for proxy '${proxyJumpAlias}'` },
                    ],
                    isError: true,
                };
            }
            ssh = await sshManager.connectWithProxy(proxySshConfig, sshConfig);
        } else {
            ssh = await sshManager.connect(sshConfig);
        }
    } catch (err) {
        logger.error({ host, proxyJump: proxyJumpAlias, error: (err as Error).message }, "SSH connection failed");
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: SSH connection failed: ${(err as Error).message}`,
                },
            ],
            isError: true,
        };
    }

    const tmuxInstalled = await tmuxManager.isInstalled(ssh);
    if (!tmuxInstalled) {
        sshManager.disconnect(ssh);
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: tmux is not installed on host '${host}'.`,
                },
            ],
            isError: true,
        };
    }

    const exists = await tmuxManager.hasSession(ssh, tmux_session);
    if (!exists) {
        sshManager.disconnect(ssh);
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: tmux session '${tmux_session}' does not exist on host '${host}'.`,
                },
            ],
            isError: true,
        };
    }

    // Inject deterministic prompt with retry + verification
    let promptInjected = false;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await new Promise((r) => setTimeout(r, 300));
            await tmuxManager.injectPrompt(ssh, tmux_session);
            await new Promise((r) => setTimeout(r, 300));
            const output = await tmuxManager.capturePane(ssh, tmux_session, 10);
            if (output.includes(MCP_PROMPT)) {
                promptInjected = true;
                break;
            }
        } catch {
            logger.warn({ host, tmux_session, attempt }, "Prompt injection retry");
        }
    }
    if (!promptInjected) {
        logger.warn({ host, tmux_session }, "Failed to inject prompt after retries, continuing");
    }

    const session = sessionManager.create(host, ssh, tmux_session);

    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(
                    {
                        session_id: session.id,
                        host: session.host,
                        tmux_session: session.tmuxSession,
                        status: "reconnected",
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
