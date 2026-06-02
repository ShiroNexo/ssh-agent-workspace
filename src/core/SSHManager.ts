import { Client, type ConnectConfig, SFTPWrapper } from "ssh2";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

export interface SFTPEntry {
    filename: string;
    longname: string;
    attrs: {
        mode: number;
        uid: number;
        gid: number;
        size: number;
        atime: number;
        mtime: number;
        isDirectory: boolean;
        isFile: boolean;
        isSymbolicLink: boolean;
    };
}

export interface SFTPStat {
    mode: number;
    uid: number;
    gid: number;
    size: number;
    atime: number;
    mtime: number;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
}

export class SSHManager {
    async connect(config: ConnectConfig): Promise<Client> {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error(`SSH connection timeout to ${config.host}`));
            }, 30000);

            client.on("ready", () => {
                clearTimeout(timeout);
                logger.info({ host: config.host }, "SSH connection established");
                resolve(client);
            });

            client.on("error", (err) => {
                clearTimeout(timeout);
                logger.error({ host: config.host, error: err.message }, "SSH connection error");
                reject(err);
            });

            client.on("close", () => {
                logger.info({ host: config.host }, "SSH connection closed");
            });

            client.on("end", () => {
                logger.debug({ host: config.host }, "SSH connection ended");
            });

            client.connect(config);
        });
    }

    private getSftp(ssh: Client, timeoutMs = 30000): Promise<SFTPWrapper> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP session timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            ssh.sftp((err, sftp) => {
                clearTimeout(timer);
                if (err) return reject(err);
                resolve(sftp);
            });
        });
    }

    async sftpUpload(ssh: Client, localPath: string, remotePath: string, timeoutMs = 300000): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP upload timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.fastPut(localPath, remotePath, (err) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    logger.info({ localPath, remotePath }, "SFTP upload complete");
                    resolve();
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    async sftpDownload(ssh: Client, remotePath: string, localPath: string, timeoutMs = 300000): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP download timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.fastGet(remotePath, localPath, (err) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    logger.info({ remotePath, localPath }, "SFTP download complete");
                    resolve();
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    async sftpList(ssh: Client, remotePath: string, timeoutMs = 30000): Promise<SFTPEntry[]> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP list timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.readdir(remotePath, (err, entries) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    const result: SFTPEntry[] = (
                        entries as Array<{
                            filename: string;
                            longname: string;
                            attrs: {
                                mode: number;
                                size: number;
                                uid: number;
                                gid: number;
                                atime: number;
                                mtime: number;
                            };
                        }>
                    ).map((entry) => ({
                        filename: entry.filename,
                        longname: entry.longname,
                        attrs: {
                            mode: entry.attrs.mode,
                            uid: entry.attrs.uid,
                            gid: entry.attrs.gid,
                            size: entry.attrs.size,
                            atime: entry.attrs.atime,
                            mtime: entry.attrs.mtime,
                            isDirectory: (entry.attrs.mode & 0o40000) !== 0,
                            isFile: (entry.attrs.mode & 0o100000) !== 0,
                            isSymbolicLink: (entry.attrs.mode & 0o120000) !== 0,
                        },
                    }));
                    resolve(result);
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    async sftpStat(ssh: Client, remotePath: string, timeoutMs = 15000): Promise<SFTPStat> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP stat timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.stat(remotePath, (err, stats) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    resolve({
                        mode: stats.mode,
                        uid: stats.uid,
                        gid: stats.gid,
                        size: stats.size,
                        atime: stats.atime,
                        mtime: stats.mtime,
                        isDirectory: (stats.mode & 0o40000) !== 0,
                        isFile: (stats.mode & 0o100000) !== 0,
                        isSymbolicLink: (stats.mode & 0o120000) !== 0,
                    });
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    async sftpExists(ssh: Client, remotePath: string, timeoutMs = 15000): Promise<boolean> {
        try {
            await this.sftpStat(ssh, remotePath, timeoutMs);
            return true;
        } catch {
            return false;
        }
    }

    async sftpMkdir(ssh: Client, remotePath: string, timeoutMs = 15000): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP mkdir timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.mkdir(remotePath, {}, (err) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    logger.info({ remotePath }, "SFTP directory created");
                    resolve();
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    async sftpUnlink(ssh: Client, remotePath: string, timeoutMs = 15000): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`SFTP unlink timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            try {
                const sftp = await this.getSftp(ssh);
                sftp.unlink(remotePath, (err) => {
                    clearTimeout(timer);
                    if (err) return reject(err);
                    logger.info({ remotePath }, "SFTP file deleted");
                    resolve();
                });
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    isAlive(ssh: Client): boolean {
        try {
            return !(ssh as any)._destroyed && !(ssh as any)._sock?.destroyed;
        } catch {
            return false;
        }
    }

    async exec(
        ssh: Client,
        command: string,
        timeoutMs = 30000,
    ): Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
        signal: string | null;
    }> {
        return new Promise((resolve, reject) => {
            ssh.exec(command, (err, stream) => {
                if (err) {
                    return reject(err);
                }

                const timer = setTimeout(() => {
                    stream.close();
                    reject(new Error(`Command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`));
                }, timeoutMs);

                let stdout = "";
                let stderr = "";

                stream.on("data", (data: Buffer) => {
                    stdout += data.toString("utf8");
                });

                stream.stderr.on("data", (data: Buffer) => {
                    stderr += data.toString("utf8");
                });

                stream.on("close", (code: number | null, signal: string | null) => {
                    clearTimeout(timer);
                    resolve({ stdout, stderr, code, signal });
                });

                stream.on("error", (err: Error) => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
        });
    }

    async connectWithProxy(proxyConfig: ConnectConfig, targetConfig: ConnectConfig): Promise<Client> {
        const proxy = await this.connect(proxyConfig);

        let proxyStream;
        try {
            proxyStream = await new Promise<import("ssh2").ClientChannel>((resolve, reject) => {
                const host = targetConfig.host || "localhost";
                const port = targetConfig.port || 22;
                proxy.forwardOut("127.0.0.1", 0, String(host), port, (err, stream) => {
                    if (err) return reject(err);
                    resolve(stream);
                });
            });
        } catch (err) {
            proxy.destroy();
            throw new Error(`Proxy forwardOut failed: ${(err as Error).message}`);
        }

        return new Promise((resolve, reject) => {
            const client = new Client();
            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error(`SSH connection via proxy timeout to ${targetConfig.host}`));
            }, 30000);

            client.on("ready", () => {
                clearTimeout(timeout);
                logger.info({ host: targetConfig.host, via: proxyConfig.host }, "SSH connection established via proxy");
                resolve(client);
            });

            client.on("error", (err) => {
                clearTimeout(timeout);
                logger.error({ host: targetConfig.host, error: err.message }, "SSH proxy connection error");
                reject(err);
            });

            client.on("close", () => {
                proxy.destroy();
                logger.info({ host: targetConfig.host }, "SSH proxy connection closed");
            });

            client.connect({ ...targetConfig, sock: proxyStream as any });
        });
    }

    disconnect(ssh: Client): void {
        try {
            ssh.destroy();
        } catch (err) {
            logger.error({ error: (err as Error).message }, "Error destroying SSH client");
        }
    }
}
