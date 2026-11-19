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

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    REDIS_URL: z.url(),

    JWT_ACCESS_SECRET: SecretSchema,
    JWT_REFRESH_SECRET: SecretSchema,
    JWT_ACCESS_TTL: DurationSchema.default(15 * 60),
    JWT_REFRESH_TTL: DurationSchema.default(30 * 86_400),

    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
    GOOGLE_OAUTH_CALLBACK_URL: z.url(),
    FACEBOOK_OAUTH_CLIENT_ID: z.string().min(1),
    FACEBOOK_OAUTH_CLIENT_SECRET: z.string().min(1),
    FACEBOOK_OAUTH_CALLBACK_URL: z.url(),

    WEB_ORIGIN: z.url().default('http://localhost:3000'),
    ADMIN_ORIGIN: z.url().default('http://localhost:5173'),
    /** Where the browser lands after a successful/failed OAuth login (per app). */
    AUTH_REDIRECT_URL_WEB: z.url().default('http://localhost:3000/auth/callback'),
    AUTH_REDIRECT_URL_ADMIN: z.url().default('http://localhost:5173/auth/callback'),
  })
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (!env.JWT_ACCESS_SECRET.startsWith('change-me') &&
        !env.JWT_REFRESH_SECRET.startsWith('change-me')),
    {
      message: 'Placeholder JWT secrets are not allowed in production',
      path: ['JWT_ACCESS_SECRET'],
    },
  );

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
