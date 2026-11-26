// Shared by the orchestrator (scripts/run.ts) and the Playwright tests: ports, origins and the
// test-only secrets. Everything is overridable through E2E_* env vars. These secrets protect
// nothing real — they exist only inside a throwaway stack on localhost.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export const PORTS = {
  web: num('E2E_WEB_PORT', 4100),
  api: num('E2E_API_PORT', 4101),
  admin: num('E2E_ADMIN_PORT', 4102),
  /** Fake payment gateway page (VNPay `vnp_Url` target). */
  gateway: num('E2E_GATEWAY_PORT', 4103),
  /** SMTP sink the worker sends its emails to. */
  smtp: num('E2E_SMTP_PORT', 4104),
} as const;

export const ORIGINS = {
  web: `http://localhost:${PORTS.web}`,
  api: `http://localhost:${PORTS.api}`,
  admin: `http://localhost:${PORTS.admin}`,
  gateway: `http://localhost:${PORTS.gateway}`,
} as const;

export const SECRETS = {
  jwtAccess: 'e2e-access-secret-0123456789abcdef-0123456789',
  jwtRefresh: 'e2e-refresh-secret-0123456789abcdef-012345678',
  crmUnsubscribe: 'e2e-crm-unsubscribe-secret-0123456789abcdef',
  vnpayTmnCode: 'E2ETMN01',
  vnpayHashSecret: 'e2e-vnpay-hash-secret-0123456789',
  stripeSecretKey: 'sk_test_e2e_dummy',
  stripeWebhookSecret: 'whsec_e2e_dummy_secret',
} as const;

/** Seeded demo accounts (`packages/db/src/seed.ts`) plus the extra rows `scripts/seed-extra.ts` adds. */
export const ACCOUNTS = {
  customer: 'customer@example.com',
  admin: 'admin@example.com',
  vendorA: 'vendor-a@example.com',
  vendorB: 'vendor-b@example.com',
  applicant: 'applicant@example.com',
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** Env var names the orchestrator uses to hand run state to the Playwright process. */
export const RUN_ENV = {
  databaseUrl: 'E2E_DATABASE_URL',
  redisUrl: 'E2E_REDIS_URL',
  sessionsFile: 'E2E_SESSIONS_FILE',
} as const;

export function requireRunEnv(name: (typeof RUN_ENV)[keyof typeof RUN_ENV]): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — run the suite through \`pnpm e2e\``);
  return value;
}
