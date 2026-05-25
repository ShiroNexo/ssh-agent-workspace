import { Client } from 'ssh2';
import { SSHManager } from './SSHManager.js';
import { logger } from '../utils/logger.js';

export const MCP_PROMPT = '__MCP_PROMPT__> ';

export class TmuxManager {
  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    this.sshManager = sshManager;
  }

  async isInstalled(ssh: Client): Promise<boolean> {
    try {
      const result = await this.sshManager.exec(ssh, 'tmux -V');
      return result.code === 0;
    } catch (err) {
      logger.debug({ error: (err as Error).message }, 'tmux check failed');
      return false;
    }
  }

  async createOrAttachSession(
    ssh: Client,
    sessionName: string
  ): Promise<void> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux new-session -A -s '${sessionName}' -d`
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to create/attach tmux session '${sessionName}': ${result.stderr || result.stdout}`
      );
    }
    logger.info({ sessionName }, 'Tmux session created/attached');
  }

  async applyOptions(ssh: Client, sessionName: string): Promise<void> {
    // Increase scrollback buffer for AI context recovery
    await this.sshManager.exec(
      ssh,
      `tmux set-option -t '${sessionName}' history-limit 50000`
    );
    // Disable mouse to avoid interfering with paste/send-keys
    await this.sshManager.exec(
      ssh,
      `tmux set-option -t '${sessionName}' mouse off`
    );
    logger.info({ sessionName }, 'Applied tmux options (history-limit=50000, mouse=off)');
  }

  async detectShell(ssh: Client, sessionName: string): Promise<string | null> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux display-message -t '${sessionName}' -p '#{pane_current_command}'`
    );
    if (result.code !== 0) {
      return null;
    }
    const shell = result.stdout.trim().toLowerCase();
    logger.info({ sessionName, shell }, 'Shell detected');
    return shell;
  }

  async injectPrompt(ssh: Client, sessionName: string): Promise<void> {
    const cmd = `export PS1='${MCP_PROMPT}'`;
    await this.sendCommand(ssh, sessionName, cmd);
    logger.info({ sessionName }, 'Injected deterministic prompt');
  }

  async healthCheck(ssh: Client, sessionName: string): Promise<boolean> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux has-session -t '${sessionName}'`
    );
    if (result.code !== 0) {
      logger.warn({ sessionName }, 'Tmux health check failed: session missing');
      return false;
    }
    return true;
  }

  async sendInput(
    ssh: Client,
    sessionName: string,
    input: string
  ): Promise<void> {
    const base64 = Buffer.from(input).toString('base64');
    const command = `printf '%s' '${base64}' | base64 -d | tmux load-buffer - && tmux paste-buffer -t '${sessionName}' -d`;
    const result = await this.sshManager.exec(ssh, command);
    if (result.code !== 0) {
      throw new Error(
        `Failed to send input to tmux session '${sessionName}': ${result.stderr || result.stdout}`
      );
    }
  }

  async sendCommand(
    ssh: Client,
    sessionName: string,
    command: string
  ): Promise<void> {
    const base64 = Buffer.from(command + '\n').toString('base64');
    const shellCommand = `printf '%s' '${base64}' | base64 -d | tmux load-buffer - && tmux paste-buffer -t '${sessionName}' -d`;
    const result = await this.sshManager.exec(ssh, shellCommand);
    if (result.code !== 0) {
      throw new Error(
        `Failed to send command to tmux session '${sessionName}': ${result.stderr || result.stdout}`
      );
    }
  }

  async sendSignal(
    ssh: Client,
    sessionName: string,
    signal: 'SIGINT' | 'SIGTERM'
  ): Promise<void> {
    const key = signal === 'SIGINT' ? 'C-c' : 'C-d';
    const result = await this.sshManager.exec(
      ssh,
      `tmux send-keys -t '${sessionName}' ${key}`
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to send signal ${signal} to tmux session '${sessionName}': ${result.stderr || result.stdout}`
      );
    }
    logger.info({ sessionName, signal }, 'Signal sent to tmux pane');
  }

  async capturePane(
    ssh: Client,
    sessionName: string,
    lines: number
  ): Promise<string> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux capture-pane -t '${sessionName}' -p -S -${lines}`
    );
    if (result.code !== 0) {
      throw new Error(
        `Failed to capture tmux pane '${sessionName}': ${result.stderr || result.stdout}`
      );
    }
    return result.stdout;
  }

  async hasSession(ssh: Client, sessionName: string): Promise<boolean> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux has-session -t '${sessionName}'`
    );
    return result.code === 0;
  }

  async listSessions(ssh: Client): Promise<string[]> {
    const result = await this.sshManager.exec(ssh, 'tmux list-sessions -F "#{session_name}"');
    if (result.code !== 0) {
      return [];
    }
    return result.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async killSession(ssh: Client, sessionName: string): Promise<void> {
    const result = await this.sshManager.exec(
      ssh,
      `tmux kill-session -t '${sessionName}'`
    );
    if (result.code !== 0) {
      logger.warn(
        { sessionName, error: result.stderr },
        'Failed to kill tmux session'
      );
    } else {
      logger.info({ sessionName }, 'Tmux session killed');
    }
  }
}
