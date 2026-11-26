import { z } from 'zod';
import type { StreamProviderConfig } from '@repo/streaming';

const PositiveIntSchema = z.coerce.number().int().positive();

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    LIVE_STREAM_PROVIDER: z.enum(['fake', 'cloudflare']).default('fake'),
    CLOUDFLARE_STREAM_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_STREAM_CUSTOMER_CODE: z.string().min(1).optional(),

    /** Dispatcher poll interval when the previous batch was not full. */
    OUTBOX_POLL_INTERVAL_MS: PositiveIntSchema.default(1_000),
    /** Max outbox rows claimed per dispatcher transaction. */
    OUTBOX_BATCH_SIZE: PositiveIntSchema.max(500).default(50),
    /** Parallel jobs per BullMQ worker (per queue, per replica). */
    OUTBOX_CONCURRENCY: PositiveIntSchema.max(100).default(5),
  })
  .superRefine((env, ctx) => {
    if (env.LIVE_STREAM_PROVIDER === 'fake' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['LIVE_STREAM_PROVIDER'],
        message: 'The fake stream provider is not allowed in production',
      });
    }
    if (env.LIVE_STREAM_PROVIDER === 'cloudflare') {
      for (const key of [
        'CLOUDFLARE_STREAM_ACCOUNT_ID',
        'CLOUDFLARE_STREAM_API_TOKEN',
        'CLOUDFLARE_STREAM_CUSTOMER_CODE',
      ] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when LIVE_STREAM_PROVIDER=cloudflare',
          });
        }
      }
    }
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

export function streamProviderConfig(env: Env): StreamProviderConfig {
  if (env.LIVE_STREAM_PROVIDER === 'fake') return { provider: 'fake' };
  const accountId = env.CLOUDFLARE_STREAM_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_STREAM_API_TOKEN;
  const customerCode = env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
  // Guaranteed by EnvSchema.superRefine; re-checked so the types narrow without casts.
  if (accountId === undefined || apiToken === undefined || customerCode === undefined) {
    throw new Error('Cloudflare Stream env vars are required when LIVE_STREAM_PROVIDER=cloudflare');
  }
  return { provider: 'cloudflare', accountId, apiToken, customerCode };
}
