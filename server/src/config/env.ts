import { z } from 'zod';

/** `15m`, `30d`, `3600s`, `12h` → seconds. Units: s | m | h | d. */
const DurationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, { message: 'Expected a duration like 15m, 12h or 30d' })
  .transform((raw) => {
    const value = Number(raw.slice(0, -1));
    const unit = raw.slice(-1);
    const factor = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
    return value * factor;
  })
  .pipe(z.number().int().positive());

const SecretSchema = z.string().min(32, { message: 'Must be at least 32 characters' });

export const NodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

/** `fake` = in-memory provider for local dev/tests (never allowed in production). */
export const LiveStreamProviderSchema = z.enum(['fake', 'cloudflare']).default('fake');

/** Required when `LIVE_STREAM_PROVIDER=cloudflare` (plan §1.7). */
const CLOUDFLARE_STREAM_KEYS = [
  'CLOUDFLARE_STREAM_ACCOUNT_ID',
  'CLOUDFLARE_STREAM_API_TOKEN',
  'CLOUDFLARE_STREAM_CUSTOMER_CODE',
  'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
  'CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET',
] as const;

export const EnvSchema = z
  .object({
    NODE_ENV: NodeEnvSchema,
    PORT: z.coerce.number().int().positive().default(3001),

    REDIS_URL: z.url(),

    JWT_ACCESS_SECRET: SecretSchema,
    JWT_REFRESH_SECRET: SecretSchema,
    JWT_ACCESS_TTL: DurationSchema.default(15 * 60),
    JWT_REFRESH_TTL: DurationSchema.default(30 * 86_400),

    /** HMAC key of the per-(customer, shop) CRM unsubscribe tokens; rotating it voids every old link. */
    CRM_UNSUBSCRIBE_SECRET: SecretSchema,

    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
    GOOGLE_OAUTH_CALLBACK_URL: z.url(),
    FACEBOOK_OAUTH_CLIENT_ID: z.string().min(1),
    FACEBOOK_OAUTH_CLIENT_SECRET: z.string().min(1),
    FACEBOOK_OAUTH_CALLBACK_URL: z.url(),

    /** S3-compatible storage (RustFS in docker-compose locally, Cloudflare R2 in prod). */
    S3_ENDPOINT: z.url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Private bucket for KYC documents (read only through short-lived presigned GETs). */
    S3_BUCKET_KYC: z.string().min(1).default('kyc'),
    /** Public-read bucket for product images and vendor logos. */
    S3_BUCKET_MEDIA: z.string().min(1).default('media'),
    /** Public base URL of the media bucket, no trailing slash needed (`<base>/<key>`). */
    MEDIA_PUBLIC_BASE_URL: z.url().default('http://localhost:9000/media'),

    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    ADMIN_ORIGIN: z.url().default('http://localhost:5173'),
    /** Where the browser lands after a successful/failed OAuth login (per app). */
    AUTH_REDIRECT_URL_WEB: z.url().default('http://localhost:3000/auth/callback'),
    AUTH_REDIRECT_URL_ADMIN: z.url().default('http://localhost:5173/auth/callback'),

    /** Requests per client IP per RATE_LIMIT_WINDOW: default bucket / `@RateLimit('strict')` routes. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_STRICT_MAX: z.coerce.number().int().positive().default(20),
    /** Public CRM unsubscribe (legal opt-out): looser than strict — NATs and mail scanners share IPs. */
    RATE_LIMIT_UNSUBSCRIBE_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW: DurationSchema.default(60),
    /**
     * Reverse proxies in front of the API that append to X-Forwarded-For (Fly.io edge = 1).
     * Decides which entry is the client IP for rate limiting; 0 = use the socket peer.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

    /**
     * Payment gateways (webhook verification only — the worker creates sessions and refunds).
     * Optional: a provider whose keys are missing is disabled and its webhook answers 503
     * `payment.error.provider-unavailable` instead of failing boot. VNPay needs TMN code + hash
     * secret; Stripe needs the secret key + webhook signing secret.
     */
    VNPAY_TMN_CODE: z.string().min(1).optional(),
    VNPAY_HASH_SECRET: z.string().min(1).optional(),
    VNPAY_PAY_URL: z.url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
    VNPAY_API_URL: z.url().default('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    LIVE_STREAM_PROVIDER: LiveStreamProviderSchema,
    CLOUDFLARE_STREAM_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_STREAM_API_TOKEN: z.string().min(1).optional(),
    CLOUDFLARE_STREAM_CUSTOMER_CODE: z.string().min(1).optional(),
    /** Stream video webhook (`Webhook-Signature` HMAC). Unset → the webhook rejects everything. */
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** Notifications webhook (`cf-webhook-auth`). Unset → the webhook rejects everything. */
    CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET: z.string().min(1).optional(),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (!env.S3_ENDPOINT.includes('localhost') && !env.MEDIA_PUBLIC_BASE_URL.includes('localhost')),
    {
      message: 'S3_ENDPOINT and MEDIA_PUBLIC_BASE_URL must not point at localhost in production',
      path: ['S3_ENDPOINT'],
    },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (!env.JWT_ACCESS_SECRET.startsWith('change-me') &&
        !env.JWT_REFRESH_SECRET.startsWith('change-me')),
    {
      message: 'Placeholder JWT secrets are not allowed in production',
      path: ['JWT_ACCESS_SECRET'],
    },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || !env.CRM_UNSUBSCRIBE_SECRET.startsWith('change-me'),
    {
      message: 'Placeholder CRM_UNSUBSCRIBE_SECRET is not allowed in production',
      path: ['CRM_UNSUBSCRIBE_SECRET'],
    },
  )
  // The fake provider hands out a guessable stream key and non-streaming URLs: a missing
  // LIVE_STREAM_PROVIDER in production must fail boot, not silently "work".
  .refine((env) => env.NODE_ENV !== 'production' || env.LIVE_STREAM_PROVIDER !== 'fake', {
    message: 'LIVE_STREAM_PROVIDER=fake is not allowed in production',
    path: ['LIVE_STREAM_PROVIDER'],
  })
  .superRefine((env, ctx) => {
    if (env.LIVE_STREAM_PROVIDER !== 'cloudflare') return;
    for (const key of CLOUDFLARE_STREAM_KEYS) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Required when LIVE_STREAM_PROVIDER=cloudflare',
          path: [key],
        });
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
