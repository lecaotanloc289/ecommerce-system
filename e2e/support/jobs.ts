import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RUN_ENV, requireRunEnv } from './config';

/**
 * Runs one scheduled job once against the e2e database (`workers/jobs` `run-job`, no Redis queue,
 * safe next to the running worker). Time is driven by moving the data (see db.ts), never by a
 * fake clock.
 */
export function runJob(name: 'auto-complete-sub-orders' | 'release-payouts'): void {
  const workerDir = resolve(process.cwd(), '..', 'workers', 'jobs');
  const result = spawnSync('node', ['dist/run-job.js', name], {
    cwd: workerDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: requireRunEnv(RUN_ENV.databaseUrl),
      REDIS_URL: requireRunEnv(RUN_ENV.redisUrl),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `run-job ${name} failed (exit ${String(result.status)}):\n${result.stdout}\n${result.stderr}`,
    );
  }
}
