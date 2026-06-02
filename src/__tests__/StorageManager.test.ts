import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { StorageManager } from "../core/StorageManager.js";

const TEST_DIR = path.join(os.tmpdir(), "dynamic-ssh-mcp-test-" + Date.now());

describe("StorageManager", () => {
    let storage: StorageManager;

    beforeEach(() => {
        storage = new StorageManager(TEST_DIR);
    });

    afterEach(() => {
        storage.shutdown();
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    it("should create storage directory on first save", () => {
        expect(fs.existsSync(TEST_DIR)).toBe(false);
        storage.save({
            id: "sess_test123",
            host: "prod",
            tmuxSession: "mcp_prod_abc",
            shell: "bash",
            connectedAt: Date.now(),
            lastActivity: Date.now(),
        });
        storage.shutdown();
        expect(fs.existsSync(TEST_DIR)).toBe(true);
        expect(fs.existsSync(path.join(TEST_DIR, "sessions.json"))).toBe(true);
    });

    it("should save and retrieve sessions", () => {
        const session = {
            id: "sess_test456",
            host: "staging",
            tmuxSession: "mcp_staging_xyz",
            shell: "zsh",
            connectedAt: 1000,
            lastActivity: 2000,
        };

        storage.save(session);
        storage.shutdown();

        // Create a new StorageManager to test persistence
        const storage2 = new StorageManager(TEST_DIR);
        const retrieved = storage2.get("sess_test456");
        expect(retrieved).toBeDefined();
        expect(retrieved!.host).toBe("staging");
        expect(retrieved!.tmuxSession).toBe("mcp_staging_xyz");
        expect(retrieved!.shell).toBe("zsh");
        expect(retrieved!.connectedAt).toBe(1000);
        storage2.shutdown();
    });

    it("should list all sessions", () => {
        storage.save({
            id: "sess_1",
            host: "prod",
            tmuxSession: "mcp_prod_1",
            connectedAt: 1,
            lastActivity: 1,
        });
        storage.save({
            id: "sess_2",
            host: "gpu",
            tmuxSession: "mcp_gpu_2",
            connectedAt: 2,
            lastActivity: 2,
        });

        const list = storage.list();
        expect(list).toHaveLength(2);
    });

    it("should list sessions by host", () => {
        storage.save({
            id: "sess_a",
            host: "prod",
            tmuxSession: "mcp_prod_a",
            connectedAt: 1,
            lastActivity: 1,
        });
        storage.save({
            id: "sess_b",
            host: "staging",
            tmuxSession: "mcp_staging_b",
            connectedAt: 2,
            lastActivity: 2,
        });
        storage.save({
            id: "sess_c",
            host: "prod",
            tmuxSession: "mcp_prod_c",
            connectedAt: 3,
            lastActivity: 3,
        });

        const prodSessions = storage.listByHost("prod");
        expect(prodSessions).toHaveLength(2);
        expect(prodSessions.map((s) => s.id)).toContain("sess_a");
        expect(prodSessions.map((s) => s.id)).toContain("sess_c");
    });

    it("should list tmux session names", () => {
        storage.save({
            id: "sess_x",
            host: "prod",
            tmuxSession: "mcp_prod_x",
            connectedAt: 1,
            lastActivity: 1,
        });
        storage.save({
            id: "sess_y",
            host: "gpu",
            tmuxSession: "mcp_gpu_y",
            connectedAt: 2,
            lastActivity: 2,
        });

        const names = storage.listTmuxSessions();
        expect(names).toContain("mcp_prod_x");
        expect(names).toContain("mcp_gpu_y");
    });

    it("should remove sessions", () => {
        storage.save({
            id: "sess_rm",
            host: "prod",
            tmuxSession: "mcp_prod_rm",
            connectedAt: 1,
            lastActivity: 1,
        });
        expect(storage.get("sess_rm")).toBeDefined();

        storage.remove("sess_rm");
        expect(storage.get("sess_rm")).toBeUndefined();

        storage.shutdown();

        // Verify removal persisted
        const storage2 = new StorageManager(TEST_DIR);
        expect(storage2.get("sess_rm")).toBeUndefined();
        storage2.shutdown();
    });

    it("should update existing session on save", () => {
        storage.save({
            id: "sess_upd",
            host: "prod",
            tmuxSession: "mcp_prod_upd",
            connectedAt: 1,
            lastActivity: 1,
        });

        storage.save({
            id: "sess_upd",
            host: "prod",
            tmuxSession: "mcp_prod_upd",
            shell: "zsh",
            connectedAt: 1,
            lastActivity: 9999,
        });

        const updated = storage.get("sess_upd");
        expect(updated!.shell).toBe("zsh");
        expect(updated!.lastActivity).toBe(9999);
        expect(storage.list()).toHaveLength(1);
    });

    it("should handle empty storage gracefully", () => {
        const list = storage.list();
        expect(list).toEqual([]);
        expect(storage.get("nonexistent")).toBeUndefined();
        expect(storage.listByHost("nonexistent")).toEqual([]);
        expect(storage.listTmuxSessions()).toEqual([]);
    });

    it("should handle corrupted storage file gracefully", () => {
        const dir = path.join(TEST_DIR);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "sessions.json"), "invalid json{{{");

        const storage2 = new StorageManager(TEST_DIR);
        expect(storage2.list()).toEqual([]);
        storage2.shutdown();
    });
});
