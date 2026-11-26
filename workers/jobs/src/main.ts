import { prisma } from '@repo/db';
import { createSmtpMailer } from './email/mailer';
import { parseEnv } from './env';
import { createHandlers } from './handlers';
import { createJobs } from './jobs';
import { JobScheduler } from './jobs/scheduler';
import { createLogger, describeError } from './logger';
import { OutboxDispatcher } from './outbox/dispatcher';
import { createProviders } from './payments/providers';
import { connectRedis } from './redis';

/**
 * Worker entry: validate env, wire dependencies, start the scheduled jobs and run the outbox
 * dispatcher until SIGTERM/SIGINT.
 */
async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const log = createLogger(env.LOG_LEVEL);

  const redis = await connectRedis(env.REDIS_URL);
  const mailer = createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  });
  const providers = createProviders(env);
  log.info({ paymentProviders: Object.keys(providers) }, 'payment providers enabled');

  const dispatcher = new OutboxDispatcher(
    createHandlers({
      mailer,
      providers,
      webOrigin: env.WEB_ORIGIN,
      adminOrigin: env.ADMIN_ORIGIN,
      apiPublicUrl: env.API_PUBLIC_URL,
    }),
    log,
    {
      batchSize: env.OUTBOX_BATCH_SIZE,
      concurrency: env.OUTBOX_CONCURRENCY,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    },
  );

  const jobs = createJobs(
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
  );
  const scheduler = new JobScheduler(
    redis,
    {
      'expire-unpaid-orders': {
        everyMs: env.JOB_EXPIRE_UNPAID_ORDERS_EVERY_MS,
        run: jobs['expire-unpaid-orders'],
      },
      'auto-complete-sub-orders': {
        everyMs: env.JOB_AUTO_COMPLETE_SUB_ORDERS_EVERY_MS,
        run: jobs['auto-complete-sub-orders'],
      },
      'release-payouts': {
        everyMs: env.JOB_RELEASE_PAYOUTS_EVERY_MS,
        run: jobs['release-payouts'],
      },
      'outbox-retention': {
        everyMs: env.JOB_OUTBOX_RETENTION_EVERY_MS,
        run: jobs['outbox-retention'],
      },
      'crm-start-campaigns': {
        everyMs: env.JOB_CRM_START_CAMPAIGNS_EVERY_MS,
        run: jobs['crm-start-campaigns'],
      },
      'crm-dispatch-messages': {
        everyMs: env.JOB_CRM_DISPATCH_MESSAGES_EVERY_MS,
        run: jobs['crm-dispatch-messages'],
      },
    } satisfies Record<keyof typeof jobs, unknown>,
    log,
  );

  const shutdown = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      log.info({ signal }, 'shutting down after the in-flight batch / job row');
      shutdown.abort();
      // In parallel with the dispatcher drain: the running job stops after its current row.
      void scheduler.close();
    });
  }

  try {
    await scheduler.start();
    await dispatcher.run(shutdown.signal);
  } finally {
    await scheduler.close(); // idempotent; waits for the running job (stopped between rows)
    mailer.close();
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // The logger may not exist yet (invalid env): write one JSON line to stderr ourselves.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'worker crashed', err: describeError(error) })}\n`,
  );
  process.exit(1);
});
