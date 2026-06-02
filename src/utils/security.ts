import { HostSecurityManager } from "../core/HostSecurityManager.js";
import { logger } from "./logger.js";

let hostSecurity: HostSecurityManager | null = null;

export function setHostSecurityManager(manager: HostSecurityManager) {
    hostSecurity = manager;
}

export function isReadOnlyMode(host?: string): boolean {
    if (host && hostSecurity?.isReadOnly(host)) return true;
    return process.env.MCP_SSH_READONLY === "true";
}

export function isHostCommandDenied(host: string, command: string): boolean {
    const global = isGlobalCommandDenied(command);
    if (global) return true;

    if (!hostSecurity) return false;

    const allowlist = hostSecurity.getAllowCommands(host);
    if (allowlist.length > 0) {
        const lower = command.toLowerCase();
        if (!allowlist.some((a) => lower.includes(a.toLowerCase()))) return true;
    }

    const denylist = hostSecurity.getDenyCommands(host);
    if (denylist.length > 0) {
        const lower = command.toLowerCase();
        if (denylist.some((d) => lower.includes(d.toLowerCase()))) return true;
    }

    return false;
}

function isGlobalCommandDenied(command: string): boolean {
    const denylist = process.env.MCP_SSH_DENYLIST_COMMANDS;
    if (!denylist) return false;
    const list = denylist
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    if (list.length === 0) return false;
    const lower = command.toLowerCase();
    return list.some((denied) => lower.includes(denied.toLowerCase()));
}

export function isHostAllowed(host: string): boolean {
    const allowed = process.env.MCP_SSH_ALLOWED_HOSTS;
    if (!allowed) return true;
    const list = allowed
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
    if (list.length === 0) return true;
    return list.includes(host);
}

export function isCommandDenied(command: string): boolean {
    return isGlobalCommandDenied(command);
}
