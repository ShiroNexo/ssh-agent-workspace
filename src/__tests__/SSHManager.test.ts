import { describe, it, expect, vi, beforeEach } from "vitest";
import { SSHManager } from "../core/SSHManager.js";
import type { SFTPWrapper } from "ssh2";

function createMockSftp() {
    return {
        fastPut: vi.fn(),
        fastGet: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
        mkdir: vi.fn(),
        unlink: vi.fn(),
    };
}

function createMockSsh(sftp?: Partial<SFTPWrapper>) {
    return {
        sftp: vi.fn((cb: (err: Error | undefined, sftp: SFTPWrapper) => void) => {
            cb(undefined, sftp as SFTPWrapper);
        }),
        exec: vi.fn(),
        on: vi.fn(),
        connect: vi.fn(),
        destroy: vi.fn(),
        removeAllListeners: vi.fn(),
    };
}

describe("SSHManager SFTP", () => {
    let sshManager: SSHManager;

    beforeEach(() => {
        sshManager = new SSHManager();
    });

    describe("sftpUpload", () => {
        it("should upload a file successfully", async () => {
            const sftp = createMockSftp();
            sftp.fastPut.mockImplementation((local: string, remote: string, cb: (err?: Error) => void) => {
                cb(undefined);
            });
            const ssh = createMockSsh(sftp) as any;

            await expect(sshManager.sftpUpload(ssh, "/local/file.txt", "/remote/file.txt")).resolves.not.toThrow();
            expect(sftp.fastPut).toHaveBeenCalledWith("/local/file.txt", "/remote/file.txt", expect.any(Function));
        });

        it("should reject on SFTP error", async () => {
            const sftp = createMockSftp();
            sftp.fastPut.mockImplementation((_l: string, _r: string, cb: (err: Error) => void) => {
                cb(new Error("Upload failed"));
            });
            const ssh = createMockSsh(sftp) as any;

            await expect(sshManager.sftpUpload(ssh, "/local/file.txt", "/remote/file.txt")).rejects.toThrow(
                "Upload failed",
            );
        });
    });

    describe("sftpDownload", () => {
        it("should download a file successfully", async () => {
            const sftp = createMockSftp();
            sftp.fastGet.mockImplementation((remote: string, local: string, cb: (err?: Error) => void) => {
                cb(undefined);
            });
            const ssh = createMockSsh(sftp) as any;

            await expect(sshManager.sftpDownload(ssh, "/remote/file.txt", "/local/file.txt")).resolves.not.toThrow();
            expect(sftp.fastGet).toHaveBeenCalledWith("/remote/file.txt", "/local/file.txt", expect.any(Function));
        });
    });

    describe("sftpList", () => {
        it("should list directory entries", async () => {
            const sftp = createMockSftp();
            sftp.readdir.mockImplementation((_path: string, cb: (err: Error | undefined, entries: any[]) => void) => {
                cb(undefined, [
                    {
                        filename: "file.txt",
                        longname: "-rw-r--r-- 1 user group 100 Jan 1 2024 file.txt",
                        attrs: {
                            mode: 0o100644,
                            size: 100,
                            uid: 1000,
                            gid: 1000,
                            atime: 1700000000,
                            mtime: 1700000000,
                        },
                    },
                    {
                        filename: "dir",
                        longname: "drwxr-xr-x 1 user group 0 Jan 1 2024 dir",
                        attrs: { mode: 0o040755, size: 0, uid: 1000, gid: 1000, atime: 1700000000, mtime: 1700000000 },
                    },
                ]);
            });
            const ssh = createMockSsh(sftp) as any;

            const entries = await sshManager.sftpList(ssh, "/remote");
            expect(entries).toHaveLength(2);
            expect(entries[0].filename).toBe("file.txt");
            expect(entries[0].attrs.isFile).toBe(true);
            expect(entries[0].attrs.isDirectory).toBe(false);
            expect(entries[1].filename).toBe("dir");
            expect(entries[1].attrs.isDirectory).toBe(true);
            expect(entries[1].attrs.isFile).toBe(false);
        });
    });

    describe("sftpStat", () => {
        it("should return file stats", async () => {
            const sftp = createMockSftp();
            sftp.stat.mockImplementation((_path: string, cb: (err: Error | undefined, stats: any) => void) => {
                cb(undefined, {
                    mode: 0o100644,
                    size: 1024,
                    uid: 1000,
                    gid: 1000,
                    atime: 1700000000,
                    mtime: 1700000000,
                });
            });
            const ssh = createMockSsh(sftp) as any;

            const stats = await sshManager.sftpStat(ssh, "/remote/file.txt");
            expect(stats.size).toBe(1024);
            expect(stats.isFile).toBe(true);
            expect(stats.isDirectory).toBe(false);
        });
    });

    describe("sftpExists", () => {
        it("should return true when file exists", async () => {
            const sftp = createMockSftp();
            sftp.stat.mockImplementation((_path: string, cb: (err: Error | undefined, stats: any) => void) => {
                cb(undefined, { mode: 0o100644, size: 0, uid: 0, gid: 0, atime: 0, mtime: 0 });
            });
            const ssh = createMockSsh(sftp) as any;

            const exists = await sshManager.sftpExists(ssh, "/remote/file.txt");
            expect(exists).toBe(true);
        });

        it("should return false when file does not exist", async () => {
            const sftp = createMockSftp();
            sftp.stat.mockImplementation((_path: string, cb: (err: Error, _stats?: any) => void) => {
                cb(new Error("No such file"), undefined);
            });
            const ssh = createMockSsh(sftp) as any;

            const exists = await sshManager.sftpExists(ssh, "/remote/nonexistent.txt");
            expect(exists).toBe(false);
        });
    });

    describe("sftpMkdir", () => {
        it("should create directory", async () => {
            const sftp = createMockSftp();
            sftp.mkdir.mockImplementation((_path: string, _opts: any, cb: (err?: Error) => void) => {
                cb(undefined);
            });
            const ssh = createMockSsh(sftp) as any;

            await expect(sshManager.sftpMkdir(ssh, "/remote/newdir")).resolves.not.toThrow();
        });
    });

    describe("sftpUnlink", () => {
        it("should delete file", async () => {
            const sftp = createMockSftp();
            sftp.unlink.mockImplementation((_path: string, cb: (err?: Error) => void) => {
                cb(undefined);
            });
            const ssh = createMockSsh(sftp) as any;

            await expect(sshManager.sftpUnlink(ssh, "/remote/file.txt")).resolves.not.toThrow();
        });
    });
});
