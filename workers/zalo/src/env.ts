import { z } from 'zod';

const PositiveIntSchema = z.coerce.number().int().positive();

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  /**
   * 32-byte key (base64) for AES-256-GCM encryption of zca-js sessions at rest
   * (`zalo_accounts.credentials`). Generate: `openssl rand -base64 32`. Rotating it invalidates
   * every stored session (shops must scan the QR again).
   */
  ZALO_CREDENTIALS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be 32 bytes, base64-encoded'),

  /** Message poll interval (claims due messages for the accounts this replica holds). */
  ZALO_POLL_INTERVAL_MS: PositiveIntSchema.default(1_000),
  /** Account sync: lease renewal, picking up ACTIVE accounts, dropping disconnected ones. */
  ZALO_ACCOUNT_SYNC_INTERVAL_MS: PositiveIntSchema.default(10_000),
  /** Per-account keep-alive (zca-js `keepAlive`) — also refreshes the stored cookies. */
  ZALO_KEEPALIVE_INTERVAL_MS: PositiveIntSchema.default(300_000),
  /** Minimum gap between two Zalo calls of one account (anti-spam pacing). */
  ZALO_SEND_MIN_INTERVAL_MS: PositiveIntSchema.default(3_000),
  /** A message still PENDING this long after `scheduledAt` is SKIPPED (account-unavailable). */
  ZALO_MESSAGE_MAX_AGE_HOURS: PositiveIntSchema.default(24),
  /** Send attempts before a message is FAILED (backoff 1, 2, 4, … min, capped at 60). */
  ZALO_MAX_SEND_ATTEMPTS: PositiveIntSchema.max(20).default(5),
  /** Consecutive login / keep-alive failures before an account is marked EXPIRED. */
  ZALO_MAX_SESSION_FAILURES: PositiveIntSchema.max(20).default(3),
  /** Hard timeout of one Zalo call (login, keep-alive, lookup, send). Keep well under 120 s (send lock). */
  ZALO_CALL_TIMEOUT_MS: PositiveIntSchema.max(60_000).default(20_000),
  /** QR logins handled at once by this replica. */
  ZALO_MAX_CONCURRENT_LOGINS: PositiveIntSchema.max(50).default(5),
  /** Hard cap on one QR login (zca-js itself expires the QR after 100 s). */
  ZALO_QR_LOGIN_TIMEOUT_MS: PositiveIntSchema.default(180_000),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses the environment; throws a readable error listing every invalid key (fails boot). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (`KEY=` in .env) as unset so defaults/required checks apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
