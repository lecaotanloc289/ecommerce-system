import { z } from 'zod';

/** Blank env values (`KEY=` in a .env file) count as unset. */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.url(),
  /** BullMQ connection — verified at boot; T3.2 hangs its repeatable jobs on it. */
  REDIS_URL: z.url(),

  /** Storefront origin: Stripe success/cancel URL and order links in emails. */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  /** Admin/vendor portal origin: link in vendor emails. */
  ADMIN_ORIGIN: z.url().default('http://localhost:5173'),
  /** Public API origin: VNPay return URL = `${API_PUBLIC_URL}/v1/payments/return/vnpay`. */
  API_PUBLIC_URL: z.url().default('http://localhost:3001'),

  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: z.string().min(1).default('Elma <no-reply@elma.local>'),

  // A provider whose credentials are missing is disabled (its payment.requested events
  // dead-letter with a clear error); the worker still boots.
  VNPAY_TMN_CODE: optional,
  VNPAY_HASH_SECRET: optional,
  VNPAY_PAY_URL: optional.pipe(z.url().optional()),
  VNPAY_API_URL: optional.pipe(z.url().optional()),
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  /** Events handled in parallel; each holds one DB connection (keep below `connection_limit`). */
  OUTBOX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment; throws one error listing every missing/invalid key. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid worker environment:\n${issues.join('\n')}`);
  }
  if (result.data.SMTP_USER !== undefined && result.data.SMTP_PASS === undefined) {
    throw new Error('Invalid worker environment:\n  - SMTP_PASS: required when SMTP_USER is set');
  }
  return result.data;
}
