import { createApp } from './app';
import { disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './utils/logger';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(
    { port: env.port, environment: env.nodeEnv },
    `LoreShelf API listening on http://localhost:${env.port}`,
  );
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down gracefully');

  // Stop accepting new connections, then release the database pool.
  server.close(() => {
    void disconnectDatabase()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Failed to disconnect from the database');
      })
      .finally(() => {
        process.exit(0);
      });
  });

  // Do not hang forever on stuck connections.
  setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception — exiting');
  process.exit(1);
});
