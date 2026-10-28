import { describe, expect, it, vi } from "vitest";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
vi.mock("node:child_process", () => ({ spawn }));

import { handleOpenTerminal } from "../tools/open_terminal.js";

describe("open_terminal", () => {
    it("passes the SSH host and tmux session as process arguments", async () => {
        const sessionManager = {
            get: vi.fn(() => ({ host: "prod", tmuxSession: "mcp_prod_123" })),
        } as any;

        const result = await handleOpenTerminal({ session_id: "sess_123" }, sessionManager);

        expect(result.isError).toBeUndefined();
        expect(spawn).toHaveBeenCalledWith(
            "powershell.exe",
            expect.arrayContaining(["prod", "mcp_prod_123"]),
            expect.objectContaining({ detached: true, stdio: "ignore" }),
        );
    });
});
