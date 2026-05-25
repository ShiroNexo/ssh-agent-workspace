#!/usr/bin/env node
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

async function main() {
  const { server, transport } = createServer();

  // Graceful shutdown
  const cleanup = () => {
    logger.info('Shutting down...');
    server
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await server.connect(transport);
  logger.info('Dynamic SSH MCP server running on stdio');
}

main().catch((err) => {
  logger.error({ error: err.message }, 'Fatal error');
  process.exit(1);
});
