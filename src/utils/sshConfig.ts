import fs from "fs";
import path from "path";
import os from "os";
import { SSHConfig } from "ssh-config";
import { logger } from "./logger.js";
import type { SSHHostConfig } from "../types/index.js";

let cachedConfig: ReturnType<typeof SSHConfig.parse> | null = null;
let cachedMtime = 0;

function getConfigPath(): string {
    return path.join(os.homedir(), ".ssh", "config");
}

function loadConfig(): ReturnType<typeof SSHConfig.parse> {
    const configPath = getConfigPath();
    try {
        const stats = fs.statSync(configPath);
        if (!cachedConfig || stats.mtimeMs !== cachedMtime) {
            const content = fs.readFileSync(configPath, "utf8");
            cachedConfig = SSHConfig.parse(content);
            cachedMtime = stats.mtimeMs;
            logger.debug({ path: configPath }, "SSH config loaded");
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            logger.warn({ path: configPath }, "SSH config not found");
        } else {
            logger.error({ error: (err as Error).message }, "Failed to load SSH config");
        }
        cachedConfig = SSHConfig.parse("");
        cachedMtime = 0;
    }
    return cachedConfig;
}

export function listHostAliases(): string[] {
    const config = loadConfig();
    const aliases: string[] = [];

    for (const line of config as unknown as Array<{
        type?: number;
        param?: string;
        value?: string | string[];
    }>) {
        if (line.param === "Host" && line.value) {
            const values = Array.isArray(line.value) ? line.value : [line.value];
            for (const value of values) {
                // Skip wildcard patterns - we only list concrete aliases
                if (!value.includes("*") && !value.includes("?")) {
                    aliases.push(value);
                }
            }
        }
    }

    return [...new Set(aliases)];
}

export function getHostConfig(alias: string): SSHHostConfig | null {
    const config = loadConfig();

    try {
        const computed = config.compute(alias) as Record<string, string | string[] | undefined>;

        if (!computed || Object.keys(computed).length === 0) {
            return null;
        }

        const getValue = (key: string): string | undefined => {
            const val = computed[key];
            if (Array.isArray(val)) return val[0];
            if (typeof val === "string") return val;
            return undefined;
        };

        return {
            name: alias,
            hostname: getValue("HostName"),
            user: getValue("User"),
            port: (() => {
                const p = getValue("Port");
                if (!p) return undefined;
                const n = parseInt(p, 10);
                return isNaN(n) ? undefined : n;
            })(),
            identityFile: getValue("IdentityFile"),
            proxyJump: getValue("ProxyJump"),
        };
    } catch (err) {
        logger.error({ alias, error: (err as Error).message }, "Failed to compute SSH host config");
        return null;
    }
}
