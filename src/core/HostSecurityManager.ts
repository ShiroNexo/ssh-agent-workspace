import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface HostSecurityEntry {
    readonly?: boolean;
    allow_commands?: string[];
    deny_commands?: string[];
}

export interface HostSecurityConfig {
    [host: string]: HostSecurityEntry;
}

const DEFAULT_DIR = path.join(os.homedir(), ".dynamic-ssh-mcp");
const CONFIG_FILE = "host_security.json";

export class HostSecurityManager {
    private config: HostSecurityConfig;
    private configPath: string;

    constructor(configDir?: string) {
        this.configPath = path.join(configDir || DEFAULT_DIR, CONFIG_FILE);
        this.config = this.load();
    }

    private load(): HostSecurityConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                return JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
            }
        } catch (err) {
            logger.warn({ err }, "Failed to load host security config");
        }
        return {};
    }

    private save(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (err) {
            logger.error({ err }, "Failed to save host security config");
        }
    }

    isReadOnly(host?: string): boolean {
        if (!host || !this.config[host]) return false;
        return this.config[host].readonly === true;
    }

    setReadOnly(host: string, readonly: boolean): void {
        if (!this.config[host]) this.config[host] = {};
        this.config[host].readonly = readonly;
        this.save();
    }

    getAllowCommands(host: string): string[] {
        return this.config[host]?.allow_commands || [];
    }

    setAllowCommands(host: string, commands: string[]): void {
        if (!this.config[host]) this.config[host] = {};
        this.config[host].allow_commands = commands;
        this.save();
    }

    getDenyCommands(host: string): string[] {
        return this.config[host]?.deny_commands || [];
    }

    setDenyCommands(host: string, commands: string[]): void {
        if (!this.config[host]) this.config[host] = {};
        this.config[host].deny_commands = commands;
        this.save();
    }

    getHostConfig(host: string): HostSecurityEntry | null {
        return this.config[host] || null;
    }

    getAll(): HostSecurityConfig {
        return { ...this.config };
    }

    removeHost(host: string): void {
        delete this.config[host];
        this.save();
    }
}
