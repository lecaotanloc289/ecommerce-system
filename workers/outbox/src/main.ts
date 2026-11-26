// Outbox worker entry point (Golden Rule #9): dispatches `outbox_events` rows onto BullMQ and runs
// their handlers. See ../CLAUDE.md.
import { createOutboxWorkerApp } from './app.js';
import { parseEnv } from './env.js';
import { createLogger } from './logger.js';

const env = parseEnv(process.env);
const logger = createLogger(env);

let stopping: Promise<void> | undefined;
function shutdown(reason: string, exitCode: number): void {
  if (stopping) return;
  logger.info({ reason }, 'shutting down');
  // Never hang forever on a stuck close (e.g. a job that ignores shutdown).
  setTimeout(() => process.exit(exitCode === 0 ? 1 : exitCode), 30_000).unref();
  stopping = app.stop().then(
    () => process.exit(exitCode),
    (err: unknown) => {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    },
  );
}

const app = createOutboxWorkerApp(env, logger, {
  onFatal: () => shutdown('worker loop crashed', 1),
});

process.on('SIGINT', () => shutdown('SIGINT', 0));
process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});

app.start().catch((err: unknown) => {
  logger.fatal({ err }, 'startup failed');
  shutdown('startup failed', 1);
});
