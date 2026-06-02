import { z } from "zod";
import fs from "fs";
import path from "path";
import { SessionManager } from "../core/SessionManager.js";
import { SSHManager } from "../core/SSHManager.js";
import { isReadOnlyMode } from "../utils/security.js";
import { logger } from "../utils/logger.js";

export const sftpDownloadSchema = z.object({
    session_id: z.string().min(1),
    remote_path: z.string().min(1).describe("Absolute path to the file on the remote host"),
    local_path: z.string().min(1).describe("Absolute destination path on the local machine"),
});

export const sftpDownloadTool = {
    name: "sftp_download",
    description: "Download a file from a remote host via SFTP. Requires an active session.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: {
                type: "string",
                description: "Session ID returned by connect",
            },
            remote_path: {
                type: "string",
                description: "Absolute path to the file on the remote host",
            },
            local_path: {
                type: "string",
                description: "Absolute destination path on the local machine",
            },
        },
        required: ["session_id", "remote_path", "local_path"],
    },
};

export async function handleSftpDownload(args: unknown, sessionManager: SessionManager, sshManager: SSHManager) {
    const parsed = sftpDownloadSchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
        };
    }

    const { session_id, remote_path, local_path } = parsed.data;

    const session = sessionManager.get(session_id);
    if (!session) {
        return {
            content: [
                { type: "text" as const, text: `Error: Session '${session_id}' not found or has been disconnected` },
            ],
            isError: true,
        };
    }

    if (isReadOnlyMode(session.host)) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Host '${session.host}' is in read-only mode. SFTP download is disabled.`,
                },
            ],
            isError: true,
        };
    }

    if (!sshManager.isAlive(session.ssh)) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: SSH connection for session '${session_id}' is dead. Reconnect with connect or reconnect_to_tmux.`,
                },
            ],
            isError: true,
        };
    }

    // Resolve and validate local destination directory
    const resolvedLocal = path.resolve(local_path);
    const localDir = path.dirname(resolvedLocal);
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }

    try {
        await sshManager.sftpDownload(session.ssh, remote_path, resolvedLocal);
        const size = fs.statSync(resolvedLocal).size;
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(
                        {
                            status: "downloaded",
                            remote_path,
                            local_path: resolvedLocal,
                            size_bytes: size,
                        },
                        null,
                        2,
                    ),
                },
            ],
        };
    } catch (err) {
        logger.error({ sessionId: session_id, error: (err as Error).message }, "SFTP download failed");
        return {
            content: [{ type: "text" as const, text: `Error: SFTP download failed: ${(err as Error).message}` }],
            isError: true,
        };
    }
}
