import { prisma } from '@repo/db';
import { parseEnv } from './env';
import { createJobs, isJobName, JOB_NAMES } from './jobs';
import { createLogger, describeError } from './logger';

/**
 * One-off run of a scheduled job, without Redis/BullMQ: `node dist/run-job.js <job-name>`
 * (`pnpm --filter @workers/jobs run-job release-payouts`). For E2E tests and operators — the
 * jobs are safe to run next to the scheduled ones (row locks + conditional updates).
 */
async function runJob(): Promise<void> {
  const name = process.argv[2] ?? '';
  if (!isJobName(name)) {
    throw new Error(`usage: run-job <${JOB_NAMES.join(' | ')}>`);
  }
  const env = parseEnv(process.env);
  const log = createLogger(env.LOG_LEVEL);
  try {
    const result = await createJobs(
      { batchSize: env.JOB_BATCH_SIZE, outboxRetentionDays: env.OUTBOX_RETENTION_DAYS },
      log,
    )[name]();
    log.info({ job: name, result }, 'job finished');
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

runJob().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'run-job failed', err: describeError(error) })}\n`,
  );
  process.exit(1);
});
