import { prisma } from '@repo/db';
import { createSmtpMailer } from './email/mailer';
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
  // Only `crm-dispatch-messages` sends mail; nodemailer connects lazily, so others never touch SMTP.
  const mailer = createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  });
  try {
    const result = await createJobs(
      {
        batchSize: env.JOB_BATCH_SIZE,
        outboxRetentionDays: env.OUTBOX_RETENTION_DAYS,
        crm: {
          mailer,
          webOrigin: env.WEB_ORIGIN,
          apiPublicUrl: env.API_PUBLIC_URL,
          unsubscribeSecret: env.CRM_UNSUBSCRIBE_SECRET,
          emailEnabled: env.CRM_EMAIL_ENABLED,
        },
      },
      log,
    )[name]();
    log.info({ job: name, result }, 'job finished');
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    mailer.close();
    await prisma.$disconnect();
  }
}

runJob().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'run-job failed', err: describeError(error) })}\n`,
  );
  process.exit(1);
});
