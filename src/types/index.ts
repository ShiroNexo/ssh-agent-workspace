import type { Client } from 'ssh2';

export interface Session {
  id: string;
  host: string;
  ssh: Client;
  connectedAt: number;
  lastActivity: number;
  tmuxSession: string;
  shell?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
}

export interface SSHHostConfig {
  name: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}
