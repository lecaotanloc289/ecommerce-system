/**
 * Jest `setupFiles` of the `integration` project: runs in every spec file before its imports, and
 * points the Prisma singleton (reads DATABASE_URL lazily, on first connect) and REDIS_URL at this
 * worker's private database / Redis logical DB created by global-setup.ts.
 */
const pattern = process.env.TEST_DATABASE_URL_PATTERN;
const redisUrl = process.env.TEST_REDIS_URL;
if (!pattern || !redisUrl) {
  throw new Error(
    'Integration harness env missing — run integration specs through jest (globalSetup starts the containers).',
  );
}

const worker = process.env.JEST_WORKER_ID ?? '1';
process.env.DATABASE_URL = pattern.replace('{worker}', worker);
process.env.REDIS_URL = `${redisUrl}/${worker}`;
