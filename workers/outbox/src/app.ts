import { prisma } from '@repo/db';
import { createStreamProvider, type StreamProvider } from '@repo/streaming';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { OutboxDispatcher, type OutboxJobData } from './dispatcher.js';
import { streamProviderConfig, type Env } from './env.js';
import { createGraceProcessor, type GraceJobData } from './grace.js';
import { registerLiveSessionHandlers } from './handlers/live-session.js';
import { createOutboxProcessor, HandlerRegistry } from './handlers/registry.js';
import type { Logger } from './logger.js';
import {
  DEFAULT_JOB_OPTIONS,
  LIVE_DISCONNECT_GRACE_QUEUE,
  OUTBOX_QUEUE,
  WORKER_SETTINGS,
} from './queues.js';

export interface OutboxWorkerApp {
  /** Starts both workers, waits for the dispatcher's Redis connection, then starts polling. */
  start(): Promise<void>;
  /** Graceful: stop polling → drain workers → close queues → quit Redis → disconnect Prisma. */
  stop(): Promise<void>;
}

export interface OutboxWorkerAppOptions {
  streamProvider?: StreamProvider;
  /** A BullMQ worker loop died (unrecoverable). main.ts logs and exits non-zero. */
  onFatal?: (err: unknown) => void;
}

export function createOutboxWorkerApp(
  env: Env,
  logger: Logger,
  options: OutboxWorkerAppOptions = {},
): OutboxWorkerApp {
  // BullMQ needs maxRetriesPerRequest: null on connections used by workers (blocking commands).
  const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // The dispatcher enqueues while holding row locks: with the offline queue disabled, a Redis
  // outage makes `addBulk` fail immediately (tx rolls back, rows stay unclaimed) instead of
  // piling commands up until the transaction times out.
  const dispatchConnection = new Redis(env.REDIS_URL, { enableOfflineQueue: false });
  // Separate connection for PUBLISH / key commands so they never queue behind BullMQ traffic.
  const redis = new Redis(env.REDIS_URL);
  for (const [name, connection] of [
    ['bull', bullConnection],
    ['dispatch', dispatchConnection],
    ['publish', redis],
  ] as const) {
    connection.on('error', (err) => logger.warn({ connection: name, err }, 'redis error'));
  }
  const streamProvider = options.streamProvider ?? createStreamProvider(streamProviderConfig(env));
  const onFatal = options.onFatal ?? ((err: unknown) => logger.fatal({ err }, 'worker crashed'));

  const outboxQueue = new Queue<OutboxJobData>(OUTBOX_QUEUE, {
    connection: dispatchConnection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const graceQueue = new Queue<GraceJobData>(LIVE_DISCONNECT_GRACE_QUEUE, {
    connection: bullConnection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  for (const queue of [outboxQueue, graceQueue]) {
    queue.on('error', (err) => logger.warn({ queue: queue.name, err }, 'queue error'));
  }

  const registry = new HandlerRegistry();
  registerLiveSessionHandlers(registry, { db: prisma, redis, streamProvider, graceQueue });

  const dispatcher = new OutboxDispatcher({
    db: prisma,
    queue: outboxQueue,
    logger,
    batchSize: env.OUTBOX_BATCH_SIZE,
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  });

  const workerOptions = {
    connection: bullConnection,
    concurrency: env.OUTBOX_CONCURRENCY,
    autorun: false,
    settings: WORKER_SETTINGS,
  };
  const outboxWorker = new Worker<OutboxJobData>(
    OUTBOX_QUEUE,
    createOutboxProcessor({ db: prisma, registry, logger }),
    workerOptions,
  );
  const graceWorker = new Worker<GraceJobData>(
    LIVE_DISCONNECT_GRACE_QUEUE,
    createGraceProcessor({ db: prisma, redis, graceQueue, logger }),
    workerOptions,
  );

  for (const worker of [outboxWorker, graceWorker]) {
    worker.on('failed', (job, err) => {
      logger.warn(
        { queue: worker.name, jobId: job?.id, attemptsMade: job?.attemptsMade, err },
        'job failed',
      );
    });
    worker.on('error', (err) => logger.error({ queue: worker.name, err }, 'worker error'));
  }

  return {
    async start() {
      for (const worker of [outboxWorker, graceWorker]) {
        worker.run().catch((err: unknown) => {
          logger.fatal({ queue: worker.name, err }, 'worker loop crashed');
          onFatal(err);
        });
      }
      await outboxQueue.waitUntilReady();
      dispatcher.start();
      logger.info(
        {
          provider: env.LIVE_STREAM_PROVIDER,
          queues: [OUTBOX_QUEUE, LIVE_DISCONNECT_GRACE_QUEUE],
          batchSize: env.OUTBOX_BATCH_SIZE,
          pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          concurrency: env.OUTBOX_CONCURRENCY,
        },
        'outbox worker started',
      );
    },
    async stop() {
      await dispatcher.stop();
      await Promise.all([outboxWorker.close(), graceWorker.close()]);
      await Promise.all([outboxQueue.close(), graceQueue.close()]);
      await Promise.all([bullConnection.quit(), dispatchConnection.quit(), redis.quit()]);
      await prisma.$disconnect();
      logger.info('outbox worker stopped');
    },
  };
}
