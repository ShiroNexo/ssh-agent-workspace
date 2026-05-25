import { Client, type ConnectConfig } from 'ssh2';
import { logger } from '../utils/logger.js';

export class SSHManager {
  async connect(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.destroy();
        reject(new Error(`SSH connection timeout to ${config.host}`));
      }, 30000);

      client.on('ready', () => {
        clearTimeout(timeout);
        logger.info({ host: config.host }, 'SSH connection established');
        resolve(client);
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        logger.error(
          { host: config.host, error: err.message },
          'SSH connection error'
        );
        reject(err);
      });

      client.on('close', () => {
        logger.info({ host: config.host }, 'SSH connection closed');
      });

      client.on('end', () => {
        logger.debug({ host: config.host }, 'SSH connection ended');
      });

      client.connect(config);
    });
  }

  async exec(
    ssh: Client,
    command: string
  ): Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
  }> {
    return new Promise((resolve, reject) => {
      ssh.exec(command, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });

        stream.on('close', (code: number | null, signal: string | null) => {
          resolve({ stdout, stderr, code, signal });
        });

        stream.on('error', (err: Error) => {
          reject(err);
        });
      });
    });
  }

  disconnect(ssh: Client): void {
    try {
      ssh.destroy();
    } catch (err) {
      logger.error(
        { error: (err as Error).message },
        'Error destroying SSH client'
      );
    }
  }
}
