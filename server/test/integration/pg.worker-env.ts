import { PG_TEST_BASE_URL, REDIS_TEST_BASE_URL, workerDatabaseUrl } from './pg.harness-state';

// Jest `setupFiles` of the `pg` project: runs in each test file's environment BEFORE the file
// (and therefore `@repo/db`, which reads DATABASE_URL) is imported.
const pgBase = process.env[PG_TEST_BASE_URL];
const redisBase = process.env[REDIS_TEST_BASE_URL];
if (!pgBase || !redisBase) {
  throw new Error('Postgres test harness not started — name the file *.pg.spec.ts');
}
const workerId = Number(process.env.JEST_WORKER_ID ?? '1');
process.env.DATABASE_URL = workerDatabaseUrl(pgBase, workerId);
process.env.REDIS_URL = `${redisBase}/${workerId}`;
