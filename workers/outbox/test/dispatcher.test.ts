import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxDispatcher, type OutboxJobData } from '../src/dispatcher.js';
import { OUTBOX_QUEUE } from '../src/queues.js';
import { ULID_REGEX } from '@repo/core';
import { ulid } from '../src/ulid.js';
import {
  db,
  insertOutboxRow,
  newQueue,
  newRedis,
  resetDb,
  silentLogger,
  waitUntil,
} from './helpers.js';

let connection: Redis;
let queue: Queue<OutboxJobData>;

function dispatcher(batchSize: number, pollIntervalMs = 1_000): OutboxDispatcher {
  return new OutboxDispatcher({ db, queue, logger: silentLogger, batchSize, pollIntervalMs });
}

async function drain(d: OutboxDispatcher): Promise<string[]> {
  const claimed: string[] = [];
  for (;;) {
    const ids = await d.dispatchOnce();
    if (ids.length === 0) return claimed;
    claimed.push(...ids);
  }
}

beforeAll(() => {
  connection = newRedis({ bull: true });
  queue = newQueue<OutboxJobData>(OUTBOX_QUEUE, connection);
});

beforeEach(async () => {
  await resetDb();
  await connection.flushdb();
});

afterAll(async () => {
  await queue.close();
  await connection.quit();
  await db.$disconnect();
});

describe('OutboxDispatcher', () => {
  it('enqueues unprocessed rows oldest first with jobId = outbox id, then marks them processed', async () => {
    const older = await insertOutboxRow(
      'live_session.started',
      { liveSessionId: ulid() },
      { createdAt: new Date(Date.now() - 60_000) },
    );
    const newer = await insertOutboxRow(
      'payment.captured',
      { paymentId: 'p1' },
      {
        aggregateType: 'Payment',
        aggregateId: 'p1',
      },
    );
    const done = await insertOutboxRow('live_session.started', { liveSessionId: ulid() });
    await db.outboxEvent.update({ where: { id: done }, data: { processedAt: new Date() } });

    const ids = await dispatcher(50).dispatchOnce();

    expect(ids).toEqual([older, newer]);
    const job = await queue.getJob(newer);
    expect(job?.name).toBe('payment.captured');
    expect(job?.data).toEqual({
      id: newer,
      aggregateType: 'Payment',
      aggregateId: 'p1',
      eventType: 'payment.captured',
      payload: { paymentId: 'p1' },
    });
    const rows = await db.outboxEvent.findMany({ where: { id: { in: [older, newer] } } });
    expect(rows.every((row) => row.processedAt !== null)).toBe(true);
    expect(await dispatcher(50).dispatchOnce()).toEqual([]);
  });

  it('two concurrent dispatchers claim every row exactly once (FOR UPDATE SKIP LOCKED)', async () => {
    const inserted: string[] = [];
    for (let i = 0; i < 120; i += 1) {
      inserted.push(await insertOutboxRow('live_session.started', { liveSessionId: ulid() }));
    }

    const [a, b] = await Promise.all([drain(dispatcher(7)), drain(dispatcher(7))]);

    expect(a.length).toBeGreaterThan(0); // both really ran concurrently
    expect(b.length).toBeGreaterThan(0);
    const all = [...a, ...b];
    expect(new Set(all).size).toBe(all.length); // no row claimed twice
    expect([...all].sort()).toEqual([...inserted].sort());
    expect(await queue.count()).toBe(120);
    expect(await db.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
  });

  it('start() polls until stop(), and stop() resolves promptly', async () => {
    const d = dispatcher(50, 20);
    d.start();
    const id = await insertOutboxRow('live_session.started', { liveSessionId: ulid() });
    await waitUntil('row dispatched', async () => (await queue.getJob(id)) !== undefined);
    const started = Date.now();
    await d.stop();
    expect(Date.now() - started).toBeLessThan(1_000);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.processedAt).not.toBeNull();
  });

  it('stop() during an in-flight tick returns without sleeping a full interval', async () => {
    await insertOutboxRow('live_session.started', { liveSessionId: ulid() });
    const d = dispatcher(50, 10_000);
    d.start(); // the first tick is now in flight (awaiting the DB)
    const started = Date.now();
    await d.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a failing enqueue rolls the claim back: processed_at stays NULL and the row is re-claimed', async () => {
    class FailingQueue extends Queue<OutboxJobData> {
      override async addBulk(): Promise<never> {
        throw new Error('redis down');
      }
    }
    const failing = new FailingQueue(OUTBOX_QUEUE, { connection });
    const id = await insertOutboxRow('live_session.started', { liveSessionId: ulid() });

    await expect(
      new OutboxDispatcher({
        db,
        queue: failing,
        logger: silentLogger,
        batchSize: 50,
        pollIntervalMs: 1_000,
      }).dispatchOnce(),
    ).rejects.toThrow('redis down');
    await failing.close();

    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id } })).processedAt).toBeNull();
    expect(await dispatcher(50).dispatchOnce()).toEqual([id]);
  });

  it('ulid() produces canonical ULIDs', () => {
    for (let i = 0; i < 100; i += 1) expect(ulid()).toMatch(ULID_REGEX);
    expect(ulid(0).slice(0, 10)).toBe('0000000000');
  });
});
