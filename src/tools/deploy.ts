import { z } from "zod";
import fs from "fs";
import path from "path";
import { SessionManager } from "../core/SessionManager.js";
import { SSHManager } from "../core/SSHManager.js";
import { isReadOnlyMode } from "../utils/security.js";
import { logger } from "../utils/logger.js";

export const deploySchema = z.object({
    session_id: z.string().min(1),
    files: z
        .array(
            z.object({
                local_path: z.string().min(1).describe("Absolute path to the local file"),
                remote_path: z.string().min(1).describe("Absolute destination path on the remote host"),
            }),
        )
        .min(1)
        .max(50)
        .describe("Array of {local_path, remote_path} mappings to deploy"),
    chmod: z
        .string()
        .regex(/^[0-7]{3,4}$/)
        .optional()
        .describe('Octal permissions to set on each file (e.g. "644", "755")'),
    chown: z
        .string()
        .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*:[a-zA-Z_][a-zA-Z0-9_.-]*$/)
        .optional()
        .describe('Owner:group to set on each file (e.g. "www-data:www-data")'),
    backup: z.boolean().default(true).describe("Create .bak backup of each existing remote file before overwriting"),
    restart_service: z.string().min(1).optional().describe('Service name to restart after deployment (e.g. "nginx")'),
    pre_deploy_cmd: z
        .string()
        .min(1)
        .optional()
        .describe('Command to run on remote before uploading (e.g. "systemctl stop nginx")'),
    post_deploy_cmd: z.string().min(1).optional().describe("Command to run on remote after all steps complete"),
});

export const deployTool = {
    name: "deploy",
    description:
        "Deploy files to a remote host with permission management, backup, and optional service restart. Executes: pre-command -> backup -> upload -> chmod/chown -> post-command -> restart.",
    inputSchema: {
        type: "object" as const,
        properties: {
            session_id: { type: "string", description: "Session ID returned by connect" },
            files: {
                type: "array",
                description: "Array of {local_path, remote_path} objects to deploy",
                items: {
                    type: "object",
                    properties: {
                        local_path: { type: "string", description: "Absolute path to the local file" },
                        remote_path: { type: "string", description: "Absolute destination path on the remote host" },
                    },
                    required: ["local_path", "remote_path"],
                },
            },
            chmod: { type: "string", description: 'Octal permissions (e.g. "644", "755")' },
            chown: { type: "string", description: 'Owner:group (e.g. "www-data:www-data")' },
            backup: {
                type: "boolean",
                description: "Create .bak backup of existing remote files (default: true)",
                default: true,
            },
            restart_service: { type: "string", description: "Service name to restart after deployment" },
            pre_deploy_cmd: { type: "string", description: "Command to run on remote before uploading" },
            post_deploy_cmd: { type: "string", description: "Command to run on remote after all steps" },
        },
        required: ["session_id", "files"],
    },
};

export async function handleDeploy(args: unknown, sessionManager: SessionManager, sshManager: SSHManager) {
    const parsed = deploySchema.safeParse(args);
    if (!parsed.success) {
        return {
            content: [{ type: "text" as const, text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
        };
    }

    const { session_id, files, chmod, chown, backup, restart_service, pre_deploy_cmd, post_deploy_cmd } = parsed.data;
    const session = sessionManager.get(session_id);

    if (!session) {
        return {
            content: [{ type: "text" as const, text: `Error: Session '${session_id}' not found` }],
            isError: true,
        };
    }
    if (!sshManager.isAlive(session.ssh)) {
        return {
            content: [{ type: "text" as const, text: `Error: SSH connection dead for session '${session_id}'` }],
            isError: true,
        };
    }

    if (isReadOnlyMode(session.host)) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Error: Host '${session.host}' is in read-only mode. Deploy is disabled.`,
                },
            ],
            isError: true,
        };
    }

    const report: Record<string, unknown>[] = [];
    let hadError = false;

    for (const file of files) {
        const resolvedLocal = path.resolve(file.local_path);
        const stepReport: Record<string, unknown> = {
            local_path: resolvedLocal,
            remote_path: file.remote_path,
        };

        if (!fs.existsSync(resolvedLocal)) {
            stepReport.status = "error";
            stepReport.error = "Local file not found";
            report.push(stepReport);
            hadError = true;
            continue;
        }
        if (!fs.statSync(resolvedLocal).isFile()) {
            stepReport.status = "error";
            stepReport.error = "Local path is not a file";
            report.push(stepReport);
            hadError = true;
            continue;
        }

        if (backup) {
            try {
                const exists = await sshManager.sftpExists(session.ssh, file.remote_path);
                if (exists) {
                    const backupCmd = `cp '${file.remote_path.replace(/'/g, "'\\''")}' '${file.remote_path.replace(/'/g, "'\\''")}'.bak`;
                    const bkResult = await sshManager.exec(session.ssh, backupCmd, 5000);
                    if (bkResult.code === 0) {
                        stepReport.backup = `${file.remote_path}.bak`;
                    } else {
                        stepReport.backup_warning = "Backup failed, continuing without backup";
                        logger.warn(
                            { sessionId: session_id, remote: file.remote_path, stderr: bkResult.stderr },
                            "Deploy backup failed",
                        );
                    }
                }
            } catch (err) {
                stepReport.backup_warning = `Backup check failed: ${(err as Error).message}`;
            }
        }

        try {
            await sshManager.sftpUpload(session.ssh, resolvedLocal, file.remote_path);
            stepReport.uploaded = true;
            stepReport.size = fs.statSync(resolvedLocal).size;
        } catch (err) {
            stepReport.status = "error";
            stepReport.error = `Upload failed: ${(err as Error).message}`;
            report.push(stepReport);
            hadError = true;
            continue;
        }

        if (chmod) {
            try {
                const chmodResult = await sshManager.exec(
                    session.ssh,
                    `chmod ${chmod} '${file.remote_path.replace(/'/g, "'\\''")}'`,
                    5000,
                );
                if (chmodResult.code === 0) {
                    stepReport.chmod = chmod;
                } else {
                    stepReport.chmod_error = chmodResult.stderr || "unknown";
                }
            } catch (err) {
                stepReport.chmod_error = (err as Error).message;
            }
        }

        if (chown) {
            try {
                const chownResult = await sshManager.exec(
                    session.ssh,
                    `chown ${chown} '${file.remote_path.replace(/'/g, "'\\''")}'`,
                    5000,
                );
                if (chownResult.code === 0) {
                    stepReport.chown = chown;
                } else {
                    stepReport.chown_error = chownResult.stderr || "unknown";
                }
            } catch (err) {
                stepReport.chown_error = (err as Error).message;
            }
        }

        stepReport.status = "deployed";
        report.push(stepReport);
    }

    if (restart_service) {
        try {
            const restartResult = await sshManager.exec(
                session.ssh,
                `systemctl restart '${restart_service.replace(/'/g, "'\\''")}'`,
                15000,
            );
            if (restartResult.code === 0) {
                report.push({ service: restart_service, restarted: true });
            } else {
                report.push({ service: restart_service, restarted: false, error: restartResult.stderr || "unknown" });
            }
        } catch (err) {
            report.push({ service: restart_service, restarted: false, error: (err as Error).message });
        }
    }

    const result: Record<string, unknown> = {
        session_id,
        files: report,
        total: files.length,
        deployed: report.filter((r) => r.status === "deployed").length,
    };

    if (pre_deploy_cmd) {
        try {
            const preResult = await sshManager.exec(session.ssh, pre_deploy_cmd, 30000);
            result.pre_deploy = {
                command: pre_deploy_cmd,
                exit_code: preResult.code,
                stdout: preResult.stdout.slice(0, 1000),
            };
        } catch (err) {
            result.pre_deploy_error = (err as Error).message;
        }
    }

    if (post_deploy_cmd) {
        try {
            const postResult = await sshManager.exec(session.ssh, post_deploy_cmd, 30000);
            result.post_deploy = {
                command: post_deploy_cmd,
                exit_code: postResult.code,
                stdout: postResult.stdout.slice(0, 1000),
            };
        } catch (err) {
            result.post_deploy_error = (err as Error).message;
        }
    }

    logger.info({ sessionId: session_id, deployed: result.deployed, hadError }, "Deploy complete");

    return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: hadError,
    };
}

export async function handleDeployCommand(
    args: { session_id: string; command: string },
    sessionManager: SessionManager,
    sshManager: SSHManager,
) {
    const session = sessionManager.get(args.session_id);
    if (!session) return { success: false, error: "Session not found" };
    if (!sshManager.isAlive(session.ssh)) return { success: false, error: "SSH dead" };
    try {
        const result = await sshManager.exec(session.ssh, args.command, 15000);
        return { success: result.code === 0, exit_code: result.code, stdout: result.stdout, stderr: result.stderr };
    } catch (err) {
        return { success: false, error: (err as Error).message };
    }
}
