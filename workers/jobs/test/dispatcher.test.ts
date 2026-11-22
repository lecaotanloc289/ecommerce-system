import { setTimeout as sleep } from 'node:timers/promises';
import { OrderCreatedEventSchema } from '@repo/core';
import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEAD_LETTER_AT,
  OutboxDispatcher,
  exponentialBackoff,
  type DispatcherOptions,
} from '../src/outbox/dispatcher';
import { PermanentError } from '../src/outbox/errors';
import { defineHandler, type HandlerContext, type OutboxHandler } from '../src/outbox/handler';
import { eventRow, insertEvent, makeUser, prisma, resetDb, silentLog } from './support/fixtures';

const OPTIONS: DispatcherOptions = { batchSize: 50, concurrency: 2, pollIntervalMs: 10 };

/** `order.created` payload (ids only); the handlers under test never read the order. */
const payload = () => ({ orderId: ulid(), customerId: ulid() });

function dispatcher(
  handle: (ctx: HandlerContext) => Promise<void>,
  options: Partial<DispatcherOptions> = {},
): OutboxDispatcher {
  const handlers: Record<string, OutboxHandler> = {
    'order.created': defineHandler(OrderCreatedEventSchema, (_event, ctx) => handle(ctx)),
  };
  return new OutboxDispatcher(handlers, silentLog, { ...OPTIONS, ...options });
}

const secondsFromNow = (date: Date): number => (date.getTime() - Date.now()) / 1000;

describe('OutboxDispatcher', () => {
  beforeEach(() => resetDb());
  afterAll(() => prisma.$disconnect());

  it('processes due events once and leaves future / processed ones alone', async () => {
    const due = await insertEvent('order.created', payload());
    const future = await insertEvent('order.created', payload(), {
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    const handled: string[] = [];
    const d = dispatcher((ctx) => {
      handled.push(ctx.event.id);
      return Promise.resolve();
    });

    expect(await d.pollOnce()).toBe(1);
    expect(await d.pollOnce()).toBe(0);

    expect(handled).toEqual([due.id]);
    const row = await eventRow(due.id);
    expect(row.processedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect((await eventRow(future.id)).processedAt).toBeNull();
  });

  it('two dispatchers polling in parallel never handle the same event twice', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) ids.add((await insertEvent('order.created', payload())).id);

    const calls = new Map<string, number>();
    let inFlight = 0;
    let concurrentSameEvent = false;
    const active = new Set<string>();
    const handle = async (ctx: HandlerContext): Promise<void> => {
      if (active.has(ctx.event.id)) concurrentSameEvent = true;
      active.add(ctx.event.id);
      inFlight++;
      calls.set(ctx.event.id, (calls.get(ctx.event.id) ?? 0) + 1);
      await sleep(Math.floor(Math.random() * 15));
      inFlight--;
      active.delete(ctx.event.id);
    };
    const a = dispatcher(handle, { batchSize: 7, concurrency: 3 });
    const b = dispatcher(handle, { batchSize: 7, concurrency: 3 });

    const drain = async (d: OutboxDispatcher): Promise<void> => {
      while ((await d.pollOnce()) > 0);
    };
    await Promise.all([drain(a), drain(b), drain(a), drain(b)]);

    expect(inFlight).toBe(0);
    expect(concurrentSameEvent).toBe(false);
    expect(new Set(calls.keys())).toEqual(ids);
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
    expect(await prisma.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
  });

  it('a failure records attempts + last_error and backs off; the retry then succeeds', async () => {
    const event = await insertEvent('order.created', payload());
    let fail = true;
    const d = dispatcher(() =>
      fail ? Promise.reject(new Error('SMTP down for lan@example.com')) : Promise.resolve(),
    );

    await d.pollOnce();
    const failed = await eventRow(event.id);
    expect(failed.processedAt).toBeNull();
    expect(failed.attempts).toBe(1);
    expect(failed.lastError).toBe('Error: SMTP down for [email]');
    expect(secondsFromNow(failed.nextAttemptAt)).toBeGreaterThan(3);
    expect(secondsFromNow(failed.nextAttemptAt)).toBeLessThanOrEqual(6);
    expect(await d.pollOnce()).toBe(0); // backing off

    fail = false;
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect(await d.pollOnce()).toBe(1);
    const done = await eventRow(event.id);
    expect(done.processedAt).not.toBeNull();
    expect(done.attempts).toBe(2);
  });

  it('rolls back the handler writes of a failed attempt', async () => {
    const user = await makeUser({ name: 'Before' });
    await insertEvent('order.created', payload());
    const d = dispatcher(async (ctx) => {
      await ctx.tx.user.update({ where: { id: user.id }, data: { name: 'After' } });
      throw new Error('boom');
    });

    await d.pollOnce();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Before');
  });

  it('dead-letters after the last attempt and never claims the event again', async () => {
    const event = await insertEvent('order.created', payload(), { attempts: 2 });
    let calls = 0;
    const d = dispatcher(
      () => {
        calls++;
        return Promise.reject(new Error('still failing'));
      },
      { maxAttempts: 3 },
    );

    await d.pollOnce();
    const dead = await eventRow(event.id);
    expect(dead.attempts).toBe(3);
    expect(dead.processedAt).toBeNull();
    expect(dead.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(dead.lastError).toBe('Error: still failing');
    expect(await d.pollOnce()).toBe(0);
    expect(calls).toBe(1);
  });

  it('dead-letters a PermanentError and an invalid payload at the first attempt', async () => {
    const permanent = await insertEvent('order.created', payload());
    const invalid = await insertEvent('order.created', { orderId: 'not-a-ulid' });
    const d = dispatcher(() => Promise.reject(new PermanentError('provider refused')));

    await d.pollOnce();
    const a = await eventRow(permanent.id);
    expect(a.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(a.lastError).toBe('PermanentError: provider refused');
    const b = await eventRow(invalid.id);
    expect(b.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(b.lastError).toBe('PermanentError: invalid order.created payload (orderId, customerId)');
  });

  it('never touches event types without a registered handler (another consumer owns them)', async () => {
    const before = new Date(Date.now() - 1000);
    // Older than the registered event, so it would come first in the batch if it were claimable.
    const foreign = await insertEvent(
      'live_session.started',
      { sessionId: ulid() },
      { createdAt: new Date(Date.now() - 60_000), nextAttemptAt: before },
    );
    const own = await insertEvent('order.created', payload());
    const d = dispatcher(() => Promise.resolve(), { batchSize: 1 });

    expect(await d.pollOnce()).toBe(1); // batch of 1 is not starved by the foreign row
    for (let i = 0; i < 3; i++) expect(await d.pollOnce()).toBe(0);

    expect((await eventRow(own.id)).processedAt).not.toBeNull();
    const row = await eventRow(foreign.id);
    expect(row).toMatchObject({ processedAt: null, attempts: 0, lastError: null });
    expect(row.nextAttemptAt).toEqual(before);
  });

  it('a handler outliving the transaction timeout keeps the lease and leaves last_error', async () => {
    const event = await insertEvent('order.created', payload());
    const d = dispatcher(() => sleep(400), { txTimeoutMs: 100 });

    await d.pollOnce();

    const row = await eventRow(event.id);
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/^transaction failed: /);
    expect(secondsFromNow(row.nextAttemptAt)).toBeGreaterThan(200); // the 5-min claim lease
  });

  it('skips an event whose claim was taken over after the lease expired', async () => {
    const event = await insertEvent('order.created', payload());
    let calls = 0;
    const handle = (): Promise<void> => {
      calls++;
      return Promise.resolve();
    };
    const a = dispatcher(handle);
    const b = dispatcher(handle);

    const [claimed] = await a.claim();
    if (!claimed) throw new Error('nothing claimed');
    // A stalls past its lease; B re-claims and handles the event.
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    expect(await b.pollOnce()).toBe(1);
    expect(await a.process(claimed)).toBe('skipped');
    expect(calls).toBe(1);
    expect((await eventRow(event.id)).attempts).toBe(2);
  });

  it('dead-letters an event whose last attempt died mid-handler (lease expired)', async () => {
    // attempts = max already counted, lease over, never completed: a crash on the last attempt.
    const event = await insertEvent('order.created', payload(), { attempts: 10 });
    let calls = 0;
    await dispatcher(() => {
      calls++;
      return Promise.resolve();
    }).pollOnce();
    const row = await eventRow(event.id);
    expect(calls).toBe(0);
    expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(row.lastError).toBe('Error: worker stopped during the last attempt');
  });

  it('hands unstarted claims back on shutdown', async () => {
    const event = await insertEvent('order.created', payload());
    const stop = new AbortController();
    stop.abort();
    let calls = 0;
    expect(
      await dispatcher(() => {
        calls++;
        return Promise.resolve();
      }).pollOnce(stop.signal),
    ).toBe(1);
    const row = await eventRow(event.id);
    expect(calls).toBe(0);
    expect(row.attempts).toBe(0);
    expect(row.processedAt).toBeNull();
    expect(secondsFromNow(row.nextAttemptAt)).toBeLessThanOrEqual(0);
  });

  it('run() polls until aborted', async () => {
    await insertEvent('order.created', payload());
    const stop = new AbortController();
    let calls = 0;
    const running = dispatcher(() => {
      calls++;
      stop.abort();
      return Promise.resolve();
    }).run(stop.signal);
    await running;
    expect(calls).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { processedAt: null } })).toBe(0);
  });
});

describe('exponentialBackoff', () => {
  it('doubles from 5s and caps at 1h', () => {
    expect([1, 2, 3, 4].map(exponentialBackoff)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(exponentialBackoff(30)).toBe(3_600_000);
  });
});
