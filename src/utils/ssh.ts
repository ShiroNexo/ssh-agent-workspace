import fs from 'fs';
import os from 'os';
import type { ConnectConfig } from 'ssh2';
import { logger } from './logger.js';
import type { SSHHostConfig } from '../types/index.js';

export function buildSshConfig(hostConfig: SSHHostConfig, readyTimeout = 20000): ConnectConfig | null {
  const config: ConnectConfig = {
    host: hostConfig.hostname || hostConfig.name,
    port: hostConfig.port || 22,
    username: hostConfig.user || process.env.USER || 'root',
    readyTimeout,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    // Try SSH agent first if available (ssh-agent / Pageant)
    agent: process.env.SSH_AUTH_SOCK || undefined,
  };

  if (hostConfig.identityFile) {
    const keyPath = hostConfig.identityFile.replace(/^~(?=$|\/)/, os.homedir());
    if (fs.existsSync(keyPath)) {
      try {
        config.privateKey = fs.readFileSync(keyPath);
      } catch (err) {
        logger.error({ keyPath, error: (err as Error).message }, 'Failed to read SSH key');
        return null;
      }
    }
  }

  return config;
}
