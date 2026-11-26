import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import pg from 'pg';
import { ACCOUNTS, ORIGINS, PORTS, RUN_ENV, SECRETS } from '../support/config';
import { seedExtra } from './seed-extra';
import { startGatewayStub, startSmtpSink } from './stubs';

/**
 * `pnpm e2e` — boots an isolated stack and runs the Playwright suite against it:
 *   1. a throwaway Postgres database (migrated + seeded) and a dedicated Redis logical DB,
 *   2. the API, the worker, the storefront (`next start`) and the admin (`vite preview`),
 *   3. a fake payment gateway page + an SMTP sink,
 *   4. refresh-token sessions for the seeded users (server/test/e2e/mint-sessions.ts),
 * then tears everything down (processes, database, Redis keys).
 *
 * Env: E2E_PG_ADMIN_URL (default local postgres), E2E_REDIS_URL (default redis://localhost:6379/13,
 * flushed!), E2E_SKIP_BUILD=1, E2E_BROWSER_CHANNEL (e.g. `chrome`), *_PORT overrides (config.ts).
 * Extra CLI args go to `playwright test` (e.g. `--headed`, `-g "payout"`).
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const e2eDir = resolve(root, 'e2e');
const tmpDir = resolve(e2eDir, '.tmp');
const SESSIONS_PER_USER = 12;

function log(message: string): void {
  process.stdout.write(`[e2e] ${message}\n`);
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('The e2e runner refuses to run with NODE_ENV=production');
}

const pgAdminUrl =
  process.env.E2E_PG_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/13';
// The runner FLUSHES this Redis logical DB at start and end: never DB 0, never a remote host.
{
  const parsed = new URL(redisUrl);
  const index = Number(parsed.pathname.replace('/', '') || '0');
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (!Number.isInteger(index) || index < 1 || (!isLocal && process.env.CI !== 'true')) {
    throw new Error(
      `E2E_REDIS_URL must name a dedicated logical DB (index >= 1) on localhost (or run in CI): ${parsed.hostname}/${index}`,
    );
  }
}
const dbName = `e2e_${randomBytes(4).toString('hex')}`;
const databaseUrl = withDatabase(pgAdminUrl, dbName);

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.search = '?schema=public';
  return url.toString();
}

const children: ChildProcess[] = [];
const closers: Array<() => Promise<void> | void> = [];

function run(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string = root,
): void {
  log(`${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${String(result.status)})`);
}

function start(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): void {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true, // own process group → killed as a whole in teardown
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `[${label}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      if (process.env.E2E_VERBOSE === '1') process.stdout.write(prefix + chunk.toString());
    });
  }
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && !tearingDown) log(`${label} exited with code ${code}`);
  });
  children.push(child);
}

async function waitFor(url: string, label: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${label} did not become ready at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let tearingDown = false;
let teardownPromise: Promise<void> | undefined;
/** Idempotent: every caller (signal handler, `finally`) awaits the same single teardown. */
function teardown(): Promise<void> {
  teardownPromise ??= doTeardown();
  return teardownPromise;
}

async function doTeardown(): Promise<void> {
  tearingDown = true;
  for (const child of children) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const child of children) {
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  for (const closer of closers.reverse()) {
    try {
      await closer();
    } catch (error) {
      log(`teardown step failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function baseEnv(): NodeJS.ProcessEnv {
  // `migrate deploy` never touches the shadow DB, but Prisma insists the URL differs from the main one.
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: withDatabase(pgAdminUrl, `${dbName}_shadow`),
  };
}

function apiEnv(): NodeJS.ProcessEnv {
  return {
    ...baseEnv(),
    NODE_ENV: 'test',
    PORT: String(PORTS.api),
    REDIS_URL: redisUrl,
    JWT_ACCESS_SECRET: SECRETS.jwtAccess,
    JWT_REFRESH_SECRET: SECRETS.jwtRefresh,
    // Shared by the API (unsubscribe links) and the worker (CRM emails); both refuse to boot without it.
    CRM_UNSUBSCRIBE_SECRET: SECRETS.crmUnsubscribe,
    // OAuth is never exercised (sessions are minted); the API only needs the keys to boot.
    GOOGLE_OAUTH_CLIENT_ID: 'e2e',
    GOOGLE_OAUTH_CLIENT_SECRET: 'e2e',
    GOOGLE_OAUTH_CALLBACK_URL: `${ORIGINS.api}/v1/auth/google/callback`,
    FACEBOOK_OAUTH_CLIENT_ID: 'e2e',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'e2e',
    FACEBOOK_OAUTH_CALLBACK_URL: `${ORIGINS.api}/v1/auth/facebook/callback`,
    S3_ACCESS_KEY_ID: 'e2e',
    S3_SECRET_ACCESS_KEY: 'e2e',
    WEB_ORIGIN: ORIGINS.web,
    ADMIN_ORIGIN: ORIGINS.admin,
    AUTH_REDIRECT_URL_WEB: `${ORIGINS.web}/auth/callback`,
    AUTH_REDIRECT_URL_ADMIN: `${ORIGINS.admin}/auth/callback`,
    RATE_LIMIT_MAX: '100000',
    RATE_LIMIT_STRICT_MAX: '100000',
    VNPAY_TMN_CODE: SECRETS.vnpayTmnCode,
    VNPAY_HASH_SECRET: SECRETS.vnpayHashSecret,
    VNPAY_PAY_URL: `${ORIGINS.gateway}/vpcpay.html`,
    VNPAY_API_URL: `${ORIGINS.gateway}/api`,
    STRIPE_SECRET_KEY: SECRETS.stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: SECRETS.stripeWebhookSecret,
  };
}

function workerEnv(): NodeJS.ProcessEnv {
  const api = apiEnv();
  return {
    ...baseEnv(),
    NODE_ENV: 'test',
    REDIS_URL: redisUrl,
    WEB_ORIGIN: ORIGINS.web,
    ADMIN_ORIGIN: ORIGINS.admin,
    API_PUBLIC_URL: ORIGINS.api,
    CRM_UNSUBSCRIBE_SECRET: api.CRM_UNSUBSCRIBE_SECRET,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(PORTS.smtp),
    VNPAY_TMN_CODE: api.VNPAY_TMN_CODE,
    VNPAY_HASH_SECRET: api.VNPAY_HASH_SECRET,
    VNPAY_PAY_URL: api.VNPAY_PAY_URL,
    VNPAY_API_URL: api.VNPAY_API_URL,
    OUTBOX_POLL_INTERVAL_MS: '300',
    LOG_LEVEL: 'warn',
  };
}

async function main(): Promise<number> {
  // --- infrastructure -------------------------------------------------------------------
  const admin = new pg.Client({ connectionString: pgAdminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  closers.push(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    log(`dropped database ${dbName}`);
  });
  log(`created database ${dbName}`);

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  await redis.flushdb();
  closers.push(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  const gateway = await startGatewayStub(PORTS.gateway);
  const smtp = await startSmtpSink(PORTS.smtp);
  closers.push(
    () => new Promise<void>((done) => gateway.close(() => done())),
    () => new Promise<void>((done) => smtp.close(() => done())),
  );

  // --- schema + data --------------------------------------------------------------------
  run('migrate', 'pnpm', ['--filter', '@repo/db', 'migrate:deploy'], baseEnv());
  run('seed', 'pnpm', ['--filter', '@repo/db', 'seed'], baseEnv());
  await seedExtra(databaseUrl);

  // --- builds ---------------------------------------------------------------------------
  const webEnv = {
    ...process.env,
    NEXT_PUBLIC_API_URL: ORIGINS.api,
    NEXT_PUBLIC_ADMIN_URL: ORIGINS.admin,
    API_URL: ORIGINS.api,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  if (process.env.E2E_SKIP_BUILD !== '1') {
    // The frontends bake the API origin in at build time, so they are rebuilt for the e2e ports.
    run(
      'build deps',
      'pnpm',
      [
        'turbo',
        'run',
        'build',
        '--filter=@server/api',
        '--filter=@workers/jobs',
        // The frontends are built below with the e2e origins; their workspace deps
        // (`@repo/sdk`, `@repo/i18n`, …) must exist in `dist/` first (a clean CI checkout has none).
        '--filter=@apps/web^...',
        '--filter=@apps/admin^...',
      ],
      process.env,
    );
    // `--no-lint`: lint/typecheck are separate CI steps (and next's lint cannot resolve the root
    // ESLint config from this package).
    run('build web', 'pnpm', ['--filter', '@apps/web', 'exec', 'next', 'build', '--no-lint'], {
      ...webEnv,
      NODE_ENV: 'production',
    });
    run(
      'build admin',
      'pnpm',
      ['--filter', '@apps/admin', 'exec', 'vite', 'build', '--outDir', 'dist-e2e', '--emptyOutDir'],
      { ...process.env, VITE_API_URL: ORIGINS.api },
    );
  }

  // --- services -------------------------------------------------------------------------
  start('api', 'node', ['dist/main.js'], apiEnv(), resolve(root, 'server'));
  start('worker', 'node', ['dist/main.js'], workerEnv(), resolve(root, 'workers/jobs'));
  start(
    'web',
    'pnpm',
    ['exec', 'next', 'start', '--port', String(PORTS.web)],
    { ...webEnv, NODE_ENV: 'production' },
    resolve(root, 'apps/client'),
  );
  start(
    'admin',
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--outDir',
      'dist-e2e',
      '--port',
      String(PORTS.admin),
      '--strictPort',
    ],
    { ...process.env, VITE_API_URL: ORIGINS.api },
    resolve(root, 'apps/admin'),
  );
  await Promise.all([
    waitFor(`${ORIGINS.api}/v1/health`, 'api'),
    waitFor(`${ORIGINS.web}/vi`, 'web'),
    waitFor(`${ORIGINS.admin}/`, 'admin'),
  ]);
  log('stack is up');

  // --- sessions -------------------------------------------------------------------------
  const emails = Object.values(ACCOUNTS);
  const minted = spawnSync(
    'pnpm',
    [
      '--silent',
      '--filter',
      '@server/api',
      'e2e:mint-sessions',
      String(SESSIONS_PER_USER),
      ...emails,
    ],
    { cwd: root, env: { ...apiEnv(), E2E_MINT_SESSIONS: '1' }, encoding: 'utf8' },
  );
  if (minted.status !== 0) throw new Error(`mint-sessions failed: ${minted.stderr}`);
  const jsonLine = minted.stdout
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('{'));
  if (!jsonLine) throw new Error('mint-sessions printed no JSON');
  mkdirSync(tmpDir, { recursive: true });
  const sessionsFile = resolve(tmpDir, 'sessions.json');
  writeFileSync(sessionsFile, jsonLine, { mode: 0o600 });
  // Run state of the suite (tokens handed out, ids passed between flows) starts fresh every run.
  rmSync(`${sessionsFile}.used`, { force: true });
  rmSync(`${sessionsFile}.state.json`, { force: true });

  // --- tests ----------------------------------------------------------------------------
  // Async on purpose: the gateway stub and SMTP sink live in this process, so its event loop must
  // keep running while the browser tests do (a `spawnSync` here would freeze them).
  const playwright = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    cwd: e2eDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      [RUN_ENV.databaseUrl]: databaseUrl,
      [RUN_ENV.redisUrl]: redisUrl,
      [RUN_ENV.sessionsFile]: sessionsFile,
    },
  });
  return new Promise<number>((done) => {
    playwright.on('exit', (code) => done(code ?? 1));
    playwright.on('error', () => done(1));
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void teardown().then(() => process.exit(130));
  });
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await teardown();
}
process.exit(exitCode);
