import type { ConnectConfig } from "ssh2";
import type { SSHHostConfig } from "../types/index.js";
import { getHostConfig } from "./sshConfig.js";
import { buildSshConfig } from "./ssh.js";
import { isHostAllowed } from "./security.js";
import { logger } from "./logger.js";

export interface ProxyResolution {
    proxyConfig: ConnectConfig | null;
    warning?: string;
}

export function resolveProxyJump(hostConfig: SSHHostConfig): ProxyResolution {
    const alias = hostConfig.proxyJump;
    if (!alias) {
        return { proxyConfig: null };
    }

    if (!isHostAllowed(alias)) {
        logger.warn({ proxy: alias }, "Proxy host not allowed, falling back to direct connection");
        return {
            proxyConfig: null,
            warning: `Ignoring proxy_jump '${alias}': proxy host is not in the allowed hosts list. Connecting directly.`,
        };
    }

    const proxyConfig = getHostConfig(alias);
    if (!proxyConfig) {
        logger.warn({ proxy: alias }, "Proxy host not found in SSH config, falling back to direct connection");
        return {
            proxyConfig: null,
            warning: `Ignoring proxy_jump '${alias}': no SSH config found for that host. Connecting directly.`,
        };
    }

    const proxySshConfig = buildSshConfig(proxyConfig);
    if (!proxySshConfig) {
        logger.warn({ proxy: alias }, "Failed to read SSH key for proxy, falling back to direct connection");
        return {
            proxyConfig: null,
            warning: `Ignoring proxy_jump '${alias}': failed to read the SSH key for the proxy host. Connecting directly.`,
        };
    }

    return { proxyConfig: proxySshConfig };
}
