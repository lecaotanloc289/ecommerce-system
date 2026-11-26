import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

/**
 * Starts ONE throwaway Postgres 16 container per `vitest run` and applies the real migrations
 * (`prisma migrate deploy` from packages/db) — the same approach as the server's Jest harness.
 * Never touches the shared local database. The URL reaches test files via `provide/inject`.
 */
const DB_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/db');

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('worker_test')
    .start();
  const url = (database: string): string =>
    `postgresql://${encodeURIComponent(postgres.getUsername())}:${encodeURIComponent(postgres.getPassword())}@${postgres.getHost()}:${postgres.getPort()}/${database}?schema=public&connection_limit=10`;

  const migrated = spawnSync(
    resolve(DB_PACKAGE_DIR, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy'],
    {
      cwd: DB_PACKAGE_DIR,
      encoding: 'utf8',
      // The schema references SHADOW_DATABASE_URL; `migrate deploy` never uses it, but it must be set.
      env: {
        ...process.env,
        DATABASE_URL: url('worker_test'),
        SHADOW_DATABASE_URL: url('unused_shadow'),
      },
    },
  );
  if (migrated.status !== 0) {
    await postgres.stop();
    throw new Error(`prisma migrate deploy failed:\n${migrated.stdout}\n${migrated.stderr}`);
  }

  project.provide('databaseUrl', url('worker_test'));
  return async () => {
    await postgres.stop();
  };
}
