import { prisma } from '@repo/db';
import { createSmtpMailer } from './email/mailer';
import { parseEnv } from './env';
import { createHandlers } from './handlers';
import { createLogger, describeError } from './logger';
import { OutboxDispatcher } from './outbox/dispatcher';
import { createProviders } from './payments/providers';
import { connectRedis } from './redis';

/** Worker entry: validate env, wire dependencies, run the outbox dispatcher until SIGTERM/SIGINT. */
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

  const shutdown = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      log.info({ signal }, 'shutting down after the in-flight batch');
      shutdown.abort();
    });
  }

  try {
    await dispatcher.run(shutdown.signal);
  } finally {
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
