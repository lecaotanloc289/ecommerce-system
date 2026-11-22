import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

/**
 * Jest globalSetup of the `integration` project (runs once per `jest` invocation, and only when
 * at least one integration spec is selected).
 *
 * Starts ONE Postgres 16 + ONE Redis 7 container for the whole run, applies the real migrations
 * (`prisma migrate deploy` from packages/db/prisma) to a template database, then clones one
 * database per Jest worker (`CREATE DATABASE worker_N TEMPLATE …`, ~50ms each). Each worker also
 * gets its own Redis logical DB (index = worker id). Spec files inside a worker run sequentially,
 * so `createTestApp()` truncating the worker's DB + FLUSHDB at the start of every file isolates
 * files without paying container start-up (~3s) + migrations (~2s) per file.
 *
 * Connection info reaches workers through env vars (workers are spawned after globalSetup and
 * inherit `process.env`); `integration-env.ts` maps them to DATABASE_URL / REDIS_URL per worker.
 */

const TEMPLATE_DB = 'harness_template';
const REDIS_DATABASES = 256;
const DB_PACKAGE_DIR = path.resolve(__dirname, '../../../packages/db');

export interface StartedContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
}

declare global {
  /** Set by globalSetup, read by globalTeardown (same Jest parent process). */
  var __serverTestContainers: StartedContainers | undefined;
}

function postgresUrl(pg: StartedPostgreSqlContainer, database: string): string {
  const auth = `${encodeURIComponent(pg.getUsername())}:${encodeURIComponent(pg.getPassword())}`;
  return `postgresql://${auth}@${pg.getHost()}:${pg.getPort()}/${database}?schema=public`;
}

export default async function globalSetup(globalConfig: { maxWorkers: number }): Promise<void> {
  const workers = Math.max(1, globalConfig.maxWorkers);
  if (workers >= REDIS_DATABASES) {
    throw new Error(`Integration tests support < ${REDIS_DATABASES} workers (got ${workers})`);
  }
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').withDatabase(TEMPLATE_DB).start(),
    new RedisContainer('redis:7-alpine')
      .withCommand(['redis-server', '--databases', String(REDIS_DATABASES)])
      .start(),
  ]);
  try {
    migrateTemplate(postgres);
    await createWorkerDatabases(postgres, workers);
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws — stop the containers here.
    await Promise.all([postgres.stop(), redis.stop()]);
    throw error;
  }
  globalThis.__serverTestContainers = { postgres, redis };

  process.env.TEST_DATABASE_URL_PATTERN = postgresUrl(postgres, 'worker_{worker}');
  process.env.TEST_REDIS_URL = redis.getConnectionUrl();
}

function migrateTemplate(postgres: StartedPostgreSqlContainer): void {
  const result = spawnSync(
    path.join(DB_PACKAGE_DIR, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy'],
    {
      cwd: DB_PACKAGE_DIR,
      encoding: 'utf8',
      // The schema references SHADOW_DATABASE_URL; `migrate deploy` never connects to it, but it
      // must be set and differ from DATABASE_URL.
      env: {
        ...process.env,
        DATABASE_URL: postgresUrl(postgres, TEMPLATE_DB),
        SHADOW_DATABASE_URL: postgresUrl(postgres, 'unused_shadow'),
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

async function createWorkerDatabases(
  postgres: StartedPostgreSqlContainer,
  workers: number,
): Promise<void> {
  const statements = Array.from({ length: workers }, (_, i) => [
    '-c',
    `CREATE DATABASE worker_${i + 1} TEMPLATE ${TEMPLATE_DB}`,
  ]).flat();
  const created = await postgres.exec([
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    postgres.getUsername(),
    '-d',
    'postgres',
    ...statements,
  ]);
  if (created.exitCode !== 0) {
    throw new Error(`Creating worker databases failed: ${created.output}`);
  }
}
