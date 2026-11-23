// Zalo worker entry point: holds shops' zca-js sessions, runs QR logins and delivers automated
// order messages (`zalo_messages`). See ../CLAUDE.md.
import { createZaloWorkerApp } from './app.js';
import { parseEnv } from './env.js';
import { errorMessage } from './accounts.js';
import { createLogger } from './logger.js';

const env = parseEnv(process.env);
const logger = createLogger(env);
const app = createZaloWorkerApp(env, logger);

let stopping: Promise<void> | undefined;
function shutdown(reason: string, exitCode: number): void {
  if (stopping) return;
  logger.info({ reason }, 'shutting down');
  // Never hang forever on a stuck close.
  setTimeout(() => process.exit(exitCode === 0 ? 1 : exitCode), 30_000).unref();
  stopping = app.stop().then(
    () => process.exit(exitCode),
    (err: unknown) => {
      logger.error({ error: errorMessage(err) }, 'shutdown failed');
      process.exit(1);
    },
  );
}

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ error: errorMessage(reason) }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});

try {
  app.start();
} catch (err) {
  logger.fatal({ error: errorMessage(err) }, 'startup failed');
  shutdown('startup failed', 1);
}
