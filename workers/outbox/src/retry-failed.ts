// Ops: re-run failed jobs (kept 7 days) with a fresh retry budget. See ../CLAUDE.md "Ops".
//   node dist/retry-failed.js                    # every failed job on both queues
//   node dist/retry-failed.js outbox             # one queue
//   node dist/retry-failed.js outbox <jobId>…    # specific jobs (outbox jobId = outbox_events.id)
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { createLogger } from './logger.js';
import { LIVE_DISCONNECT_GRACE_QUEUE, OUTBOX_QUEUE } from './queues.js';

const ArgsSchema = z.tuple([z.enum([OUTBOX_QUEUE, LIVE_DISCONNECT_GRACE_QUEUE])]).rest(z.string());
const EnvSchema = z.object({
  REDIS_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

async function retryQueue(connection: Redis, name: string, jobIds: string[]): Promise<number> {
  const queue = new Queue(name, { connection });
  try {
    const jobs =
      jobIds.length > 0
        ? await Promise.all(jobIds.map((id) => queue.getJob(id)))
        : await queue.getFailed(0, -1);
    let retried = 0;
    for (const job of jobs) {
      if (!job || (await job.getState()) !== 'failed') continue;
      await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
      retried += 1;
    }
    return retried;
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  const env = EnvSchema.parse(process.env);
  const logger = createLogger(env);
  const argv = process.argv.slice(2);
  const targets: [string, string[]][] =
    argv.length === 0
      ? [
          [OUTBOX_QUEUE, []],
          [LIVE_DISCONNECT_GRACE_QUEUE, []],
        ]
      : [ArgsSchema.parse(argv)].map(([name, ...ids]) => [name, ids]);

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  try {
    for (const [name, ids] of targets) {
      const retried = await retryQueue(connection, name, ids);
      logger.info({ queue: name, retried }, 'failed jobs moved back to wait');
    }
  } finally {
    await connection.quit();
  }
}

main().catch((err: unknown) => {
  createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'error' }).error(
    { err },
    'retry-failed failed',
  );
  process.exitCode = 1;
});
