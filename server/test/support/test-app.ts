import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { ModuleMetadata } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Role } from '@repo/core';
import type Redis from 'ioredis';
import { PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import { AppModule } from '../../src/app.module';
import { AccessTokenClaimsSchema } from '../../src/auth/auth.schemas';
import { TokenService } from '../../src/auth/token.service';
import { registerRateLimit } from '../../src/common/rate-limit';
import { ENV } from '../../src/config/config.module';
import type { Env } from '../../src/config/env';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.module';
import { testEnv } from '../helpers';

/** The Prisma client behind PrismaService — what factories write with. */
export type Db = PrismaService['client'];

export interface TestAppOptions {
  /** Env overrides on top of `testEnv()` (strings, as in process.env). REDIS_URL is ignored. */
  env?: Record<string, string>;
  /** Extra modules, e.g. a test-only module declaring a controller that imports AuthModule. */
  imports?: ModuleMetadata['imports'];
}

export interface TestApp {
  app: NestFastifyApplication;
  db: Db;
  redis: Redis;
  env: Env;
  /** `{ authorization: 'Bearer …' }` with a real access JWT built from the user's DB roles. */
  authHeader(user: { id: string }): Promise<{ authorization: string }>;
  /** Signs arbitrary claims (bypasses the DB), e.g. a stale vendorId or a role the user lost. */
  signAccessToken(user: { id: string }, roles: readonly Role[], vendorId?: string): Promise<string>;
  /** Truncates every table of this worker's database and FLUSHDBs its Redis DB. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Defaults for tests: limits high enough that only the rate-limit spec ever trips them. */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_STRICT_MAX: '100000',
};

/**
 * Real AppModule on Fastify (same plugins as main.ts: prefix `/v1`, helmet, cookie, cors, rate
 * limit) wired to this worker's Testcontainers Postgres + Redis. Starts from an empty database.
 * Integration specs only (needs the `integration` Jest project's globalSetup).
 *
 * ```ts
 * let t: TestApp;
 * beforeAll(async () => { t = await createTestApp(); });
 * afterAll(() => t.close());
 * const res = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: await t.authHeader(user) });
 * ```
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !process.env.TEST_DATABASE_URL_PATTERN) {
    throw new Error(
      'createTestApp() runs only in the integration Jest project (test/integration).',
    );
  }
  // REDIS_URL / DATABASE_URL always come from the harness; overriding them could aim reset() at
  // a real server.
  const env = testEnv({ ...TEST_ENV_DEFAULTS, ...options.env, REDIS_URL: redisUrl });
  const silentLogger: Params = { pinoHttp: { level: 'silent' } };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(silentLogger)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: true }),
    { logger: false },
  );
  // Keep in step with src/main.ts.
  app.setGlobalPrefix('v1');
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
    exposedHeaders: ['retry-after', 'idempotent-replayed'],
  });
  await registerRateLimit(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get(PrismaService).client;
  const redis = app.get<Redis>(REDIS);
  const tokens = app.get(TokenService);
  const jwt = app.get(JwtService);

  const testApp: TestApp = {
    app,
    db,
    redis,
    env,
    async authHeader(user) {
      const issued = await tokens.issueAccessToken(user.id);
      if (!issued) throw new Error(`authHeader: user ${user.id} does not exist`);
      return { authorization: `Bearer ${issued.accessToken}` };
    },
    signAccessToken(user, roles, vendorId) {
      const claims = AccessTokenClaimsSchema.parse({
        sub: user.id,
        roles,
        ...(vendorId !== undefined && { vendorId }),
      });
      return jwt.signAsync(claims, {
        secret: env.JWT_ACCESS_SECRET,
        expiresIn: env.JWT_ACCESS_TTL,
        algorithm: 'HS256',
      });
    },
    reset: () => resetState(db, redis),
    close: () => app.close(),
  };
  await testApp.reset();
  return testApp;
}

async function resetState(db: Db, redis: Redis): Promise<void> {
  // Belt and braces: never truncate anything but this worker's harness database / Redis DB.
  const worker = process.env.JEST_WORKER_ID ?? '1';
  const expectedDb = (process.env.TEST_DATABASE_URL_PATTERN ?? '').replace('{worker}', worker);
  const [connected] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (
    !expectedDb ||
    process.env.DATABASE_URL !== expectedDb ||
    connected?.name !== `worker_${worker}`
  ) {
    throw new Error(`Refusing to reset a non-harness database (${connected?.name ?? 'unknown'})`);
  }
  if (redis.options.db !== Number(worker) || !process.env.TEST_REDIS_URL) {
    throw new Error(
      `Refusing to FLUSHDB a non-harness Redis DB (${redis.options.db ?? 'unknown'})`,
    );
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  await redis.flushdb();
}
