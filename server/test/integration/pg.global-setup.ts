import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedTestContainer } from 'testcontainers';
import {
  PG_TEMPLATE_DB,
  PG_TEST_BASE_URL,
  REDIS_TEST_BASE_URL,
  workerDatabaseUrl,
} from './pg.harness-state';

const DB_PACKAGE_DIR = path.resolve(__dirname, '../../../packages/db');

/**
 * Jest globalSetup of the `pg` project (runs once, before any worker forks):
 *  1. Postgres 16 (same image as docker-compose) → `prisma migrate deploy` (the real migrations,
 *     incl. hand-written SQL) into a template DB.
 *  2. One DB per Jest worker, `CREATE DATABASE test_<N> TEMPLATE …`, so parallel files never
 *     share tables.
 *  3. Redis 7 with enough logical DBs for one per worker.
 * Base URLs go to `process.env`, which forked workers inherit; pg.worker-env.ts then points
 * DATABASE_URL / REDIS_URL at this worker's DB before any test imports `@repo/db`.
 */
export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  const workers = Math.max(1, globalConfig.maxWorkers);

  const started = await Promise.allSettled([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase(PG_TEMPLATE_DB)
      .withUsername('test')
      .withPassword('test')
      .start(),
    new RedisContainer('redis:7-alpine')
      .withCommand(['redis-server', '--databases', String(workers + 1)])
      .start(),
  ]);
  const [pgResult, redisResult] = started;
  if (pgResult.status === 'rejected' || redisResult.status === 'rejected') {
    await stopAll(
      started.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    );
    const reason =
      pgResult.status === 'rejected'
        ? pgResult.reason
        : redisResult.status === 'rejected'
          ? redisResult.reason
          : undefined;
    throw new Error('starting test containers failed', { cause: reason });
  }
  const pg = pgResult.value;
  const redis = redisResult.value;
  globalThis.__pgHarnessContainers = [pg, redis];

  try {
    await prepareDatabases(pg, workers);
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws: stop the containers here.
    globalThis.__pgHarnessContainers = undefined;
    await stopAll([pg, redis]);
    throw withProcessOutput(error);
  }

  process.env[PG_TEST_BASE_URL] = pg.getConnectionUri();
  process.env[REDIS_TEST_BASE_URL] = redis.getConnectionUrl();
}

async function prepareDatabases(pg: StartedPostgreSqlContainer, workers: number): Promise<void> {
  const templateUrl = pg.getConnectionUri();
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [DB_PACKAGE_DIR] });
  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', path.join(DB_PACKAGE_DIR, 'prisma/schema.prisma')],
    {
      cwd: DB_PACKAGE_DIR,
      // Explicit vars win over packages/db/.env (dotenv never overrides), so the local DB is
      // never touched. migrate deploy never uses the shadow DB, but the schema references it
      // (and Prisma rejects shadow == main).
      env: {
        ...process.env,
        DATABASE_URL: templateUrl,
        SHADOW_DATABASE_URL: workerDatabaseUrl(templateUrl, 0),
      },
      stdio: 'pipe',
    },
  );

  for (let worker = 1; worker <= workers; worker += 1) {
    const result = await pg.exec([
      'psql',
      '-U',
      'test',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `CREATE DATABASE test_${worker} TEMPLATE ${PG_TEMPLATE_DB}`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`creating test_${worker} failed: ${result.output}`);
    }
  }
}

async function stopAll(containers: StartedTestContainer[]): Promise<void> {
  await Promise.allSettled(containers.map((container) => container.stop()));
}

/** `execFileSync` errors carry the child's stdout/stderr (Prisma's actual message) — surface it. */
function withProcessOutput(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error));
  const output = ['stdout', 'stderr']
    .map((stream) => (stream in error ? String(Reflect.get(error, stream) ?? '') : ''))
    .filter((text) => text.trim() !== '')
    .join('\n');
  return output === '' ? error : new Error(`${error.message}\n${output}`, { cause: error });
}
