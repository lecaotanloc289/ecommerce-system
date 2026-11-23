import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '../src/jobs';
import { JobScheduler, type ScheduledJob } from '../src/jobs/scheduler';
import { connectRedis } from '../src/redis';
import { silentLog } from './support/fixtures';

// Wiring only (the job bodies are covered in jobs.test.ts): real Redis 7 container, fake runners.
describe('JobScheduler (BullMQ repeatable jobs)', () => {
  let container: StartedTestContainer;
  let url: string;

  beforeAll(async () => {
    container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  }, 120_000);
  afterAll(async () => {
    await container.stop();
  });

  it('registers one fixed schedule per job, runs them, and survives a second process', async () => {
    const queueName = 'scheduled-jobs-test';
    const runs = new Map<string, number>();
    const jobs = Object.fromEntries(
      JOB_NAMES.map((name): [string, ScheduledJob] => [
        name,
        {
          everyMs: 1000,
          run: () => {
            runs.set(name, (runs.get(name) ?? 0) + 1);
            return Promise.resolve({ ok: true });
          },
        },
      ]),
    );
    const redisA = await connectRedis(url);
    const redisB = await connectRedis(url);
    const a = new JobScheduler(redisA, jobs, silentLog, queueName);
    const b = new JobScheduler(redisB, jobs, silentLog, queueName); // a second worker machine

    try {
      await a.start();
      await b.start();

      const inspectRedis = new Redis(url, { maxRetriesPerRequest: null });
      const inspect = new Queue(queueName, { connection: inspectRedis });
      try {
        const schedulers = await inspect.getJobSchedulers();
        expect(schedulers.map((s) => s.key).sort()).toEqual([...JOB_NAMES].sort());
        expect(schedulers.every((s) => s.every === 1000)).toBe(true);
      } finally {
        await inspect.close();
        await inspectRedis.quit();
      }

      await vi.waitFor(
        () => {
          for (const name of JOB_NAMES) expect(runs.get(name) ?? 0).toBeGreaterThanOrEqual(1);
        },
        { timeout: 60_000, interval: 200 },
      );
    } finally {
      await a.close();
      await b.close();
      await redisA.quit();
      await redisB.quit();
    }
  }, 120_000);
});
