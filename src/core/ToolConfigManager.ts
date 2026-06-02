import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ToolConfig {
    [toolName: string]: boolean;
}

const DEFAULT_DIR = path.join(os.homedir(), ".dynamic-ssh-mcp");
const CONFIG_FILE = "tools.json";

export class ToolConfigManager {
    private config: ToolConfig;
    private configPath: string;

    constructor(configDir?: string) {
        this.configPath = path.join(configDir || DEFAULT_DIR, CONFIG_FILE);
        this.config = this.load();
    }

    private load(): ToolConfig {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, "utf-8");
                return JSON.parse(raw);
            }
        } catch (err) {
            logger.warn({ err }, "Failed to load tool config, using defaults");
        }
        return {};
    }

    private save(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (err) {
            logger.error({ err }, "Failed to save tool config");
        }
    }

    isEnabled(toolName: string): boolean {
        if (toolName === "tools_config") return true;
        if (!(toolName in this.config)) return true;
        return this.config[toolName];
    }

    setEnabled(toolName: string, enabled: boolean): void {
        this.config[toolName] = enabled;
        this.save();
    }

    reset(): void {
        this.config = {};
        this.save();
    }

    getAll(): ToolConfig {
        return { ...this.config };
    }
}
