import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from './core/SessionManager.js';
import { SSHManager } from './core/SSHManager.js';
import { TmuxManager } from './core/TmuxManager.js';
import { StorageManager } from './core/StorageManager.js';
import { logger } from './utils/logger.js';
import {
  listHostsTool,
  handleListHosts,
  connectTool,
  handleConnect,
  reconnectTool,
  handleReconnect,
  sendInputTool,
  handleSendInput,
  readOutputTool,
  handleReadOutput,
  execTool,
  handleExec,
  interruptTool,
  handleInterrupt,
  disconnectTool,
  handleDisconnect,
  listSessionsTool,
  handleListSessions,
  sftpUploadTool,
  handleSftpUpload,
  sftpDownloadTool,
  handleSftpDownload,
  sftpListTool,
  handleSftpList,
} from './tools/index.js';

export function createServer(storage?: StorageManager) {
  const storageManager = storage || new StorageManager();
  const server = new Server(
    {
      name: 'dynamic-ssh-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const sessionManager = new SessionManager(storageManager);
  const sshManager = new SSHManager();
  const tmuxManager = new TmuxManager(sshManager);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      listHostsTool,
      connectTool,
      reconnectTool,
      sendInputTool,
      readOutputTool,
      execTool,
      interruptTool,
      disconnectTool,
      listSessionsTool,
      sftpUploadTool,
      sftpDownloadTool,
      sftpListTool,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info({ tool: name }, 'Tool called');

    try {
      switch (name) {
        case 'list_hosts': {
          return await handleListHosts();
        }
        case 'connect': {
          return await handleConnect(
            args,
            sessionManager,
            sshManager,
            tmuxManager
          );
        }
        case 'reconnect_to_tmux': {
          return await handleReconnect(
            args,
            sessionManager,
            sshManager,
            tmuxManager
          );
        }
        case 'send_input': {
          return await handleSendInput(args, sessionManager, tmuxManager);
        }
        case 'read_output': {
          return await handleReadOutput(args, sessionManager, tmuxManager);
        }
        case 'exec': {
          return await handleExec(args, sessionManager, tmuxManager);
        }
        case 'interrupt': {
          return await handleInterrupt(args, sessionManager, tmuxManager);
        }
        case 'disconnect': {
          return await handleDisconnect(args, sessionManager, tmuxManager);
        }
        case 'list_sessions': {
          return await handleListSessions(sessionManager);
        }
        case 'sftp_upload': {
          return await handleSftpUpload(args, sessionManager, sshManager);
        }
        case 'sftp_download': {
          return await handleSftpDownload(args, sessionManager, sshManager);
        }
        case 'sftp_list': {
          return await handleSftpList(args, sessionManager, sshManager);
        }
        default: {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tool: name, error: message }, 'Unhandled tool error');
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${message}`
      );
    }
  });

  return { server, sessionManager, storageManager, transport: new StdioServerTransport() };
}
