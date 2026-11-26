import type { StartedTestContainer } from 'testcontainers';

/** Env keys the global setup hands to every worker (workers fork after globalSetup). */
export const PG_TEST_BASE_URL = 'PG_TEST_BASE_URL';
export const REDIS_TEST_BASE_URL = 'REDIS_TEST_BASE_URL';
/** Per-worker databases are cloned from this migrated template. */
export const PG_TEMPLATE_DB = 'template_migrated';

declare global {
  /** Containers started by pg.global-setup.ts, stopped by pg.global-teardown.ts (same process). */
  var __pgHarnessContainers: StartedTestContainer[] | undefined;
}

/** `postgresql://…/<db>` for Jest worker N (DB `test_<N>`, cloned from the template). */
export function workerDatabaseUrl(baseUrl: string, workerId: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/test_${workerId}`;
  return url.toString();
}
