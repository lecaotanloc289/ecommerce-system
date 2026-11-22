import { LiveEventSchema, LiveOutboxEventSchema } from '@repo/core';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  endIfStillDisconnected,
  graceJobId,
  type GraceDeps,
  type GraceJobData,
} from '../src/grace.js';
import { ENDED_SESSION_KEY_TTL_SECONDS, liveKeys } from '../src/live-events.js';
import { LIVE_DISCONNECT_GRACE_QUEUE } from '../src/queues.js';
import {
  createSession,
  db,
  fixture,
  GRACE_SECONDS,
  newQueue,
  newRedis,
  resetDb,
  silentLogger,
  subscribe,
  waitUntil,
} from './helpers.js';

let bull: Redis;
let redis: Redis;
let graceQueue: Queue<GraceJobData>;
let deps: GraceDeps;

const secondsAgo = (s: number): Date => new Date(Date.now() - s * 1_000);
const job = (liveSessionId: string, disconnectedAt: Date): GraceJobData => ({
  liveSessionId,
  disconnectedAt: disconnectedAt.toISOString(),
});

beforeAll(() => {
  bull = newRedis({ bull: true });
  redis = newRedis();
  graceQueue = newQueue<GraceJobData>(LIVE_DISCONNECT_GRACE_QUEUE, bull);
  deps = { db, redis, graceQueue, logger: silentLogger };
});

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});

afterAll(async () => {
  await graceQueue.close();
  await bull.quit();
  await redis.quit();
  await db.$disconnect();
});

describe('disconnect grace job', () => {
  it('ends a session still disconnected past grace: ENDED + outbox + publish + 24 h TTLs', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS + 5);
    const id = await createSession({
      status: 'LIVE',
      liveInputId: 'input1',
      startedAt: secondsAgo(600),
      encoderConnectedAt: null,
      encoderDisconnectedAt: disconnectedAt,
      peakViewers: 10,
    });
    await redis.set(liveKeys.peak(id), '42');
    await redis.xadd(liveKeys.chat(id), '*', 'text', 'hi');
    await redis.zadd(liveKeys.viewers(id), Date.now(), 'conn-1');
    await redis.sadd(liveKeys.muted(id), 'u1');
    const sub = await subscribe(liveKeys.events(id));

    const outcome = await endIfStillDisconnected(deps, job(id, disconnectedAt));

    expect(outcome).toBe('ended');
    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session).toMatchObject({
      status: 'ENDED',
      endReason: 'DISCONNECT_TIMEOUT',
      peakViewers: 42,
    });
    expect(session.endedAt).not.toBeNull();

    const outbox = await db.outboxEvent.findMany({ where: { aggregateId: id } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ aggregateType: 'LiveSession', processedAt: null });
    expect(
      LiveOutboxEventSchema.parse({ eventType: outbox[0]?.eventType, payload: outbox[0]?.payload }),
    ).toEqual({
      eventType: 'live_session.ended',
      payload: {
        liveSessionId: id,
        vendorId: fixture.vendorId,
        liveInputId: 'input1',
        endReason: 'DISCONNECT_TIMEOUT',
      },
    });

    await waitUntil('session.ended event', () => sub.messages.length === 1);
    expect(LiveEventSchema.parse(sub.messages[0])).toEqual({
      type: 'session.ended',
      sessionId: id,
      endedAt: session.endedAt?.toISOString(),
      endReason: 'DISCONNECT_TIMEOUT',
    });
    await sub.close();

    for (const key of [
      liveKeys.chat(id),
      liveKeys.viewers(id),
      liveKeys.peak(id),
      liveKeys.muted(id),
    ]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(ENDED_SESSION_KEY_TTL_SECONDS - 10);
      expect(ttl).toBeLessThanOrEqual(ENDED_SESSION_KEY_TTL_SECONDS);
    }
  });

  it('keeps the DB peak when Redis has no (or a lower) peak', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS + 1);
    const id = await createSession({
      status: 'LIVE',
      encoderDisconnectedAt: disconnectedAt,
      peakViewers: 7,
    });
    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt))).toBe('ended');
    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.peakViewers).toBe(7);
  });

  it('is idempotent: a repeated run re-publishes but writes no second outbox row', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS + 5);
    const id = await createSession({ status: 'LIVE', encoderDisconnectedAt: disconnectedAt });

    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt))).toBe('ended');
    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt))).toBe('replayed');
    expect(await db.outboxEvent.count({ where: { aggregateId: id } })).toBe(1);
  });

  it('reconnect inside grace keeps the session LIVE', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS + 5);
    const id = await createSession({
      status: 'LIVE',
      encoderDisconnectedAt: disconnectedAt,
      encoderConnectedAt: secondsAgo(GRACE_SECONDS - 30),
    });

    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt))).toBe('noop');

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe('LIVE');
    expect(session.endReason).toBeNull();
    expect(await db.outboxEvent.count()).toBe(0);
    expect(await graceQueue.count()).toBe(0);
  });

  it('disconnect → reconnect → disconnect: the first job does not end early, it defers to the second disconnect', async () => {
    const firstDisconnect = secondsAgo(GRACE_SECONDS + 5);
    const secondDisconnect = secondsAgo(10);
    const id = await createSession({
      status: 'LIVE',
      encoderConnectedAt: null,
      encoderDisconnectedAt: secondDisconnect,
    });

    expect(
      await endIfStillDisconnected(deps, job(id, firstDisconnect), graceJobId(id, firstDisconnect)),
    ).toBe('rescheduled');

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe('LIVE');
    expect(await db.outboxEvent.count()).toBe(0);
    // Same jobId the second disconnect's own outbox event schedules → they dedupe.
    const successor = await graceQueue.getJob(graceJobId(id, secondDisconnect));
    expect(successor?.data).toEqual(job(id, secondDisconnect));
    expect(successor?.opts.delay).toBeGreaterThan((GRACE_SECONDS - 11) * 1_000);
    expect(successor?.opts.delay).toBeLessThanOrEqual((GRACE_SECONDS - 10) * 1_000);
  });

  it('a job that fires before its own grace elapsed (clock skew) re-schedules under a new jobId', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS - 2);
    const id = await createSession({ status: 'LIVE', encoderDisconnectedAt: disconnectedAt });
    const ownId = graceJobId(id, disconnectedAt);

    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt), ownId)).toBe('rescheduled');

    const jobs = await graceQueue.getDelayed();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).not.toBe(ownId);
    expect(jobs[0]?.id?.startsWith(`${ownId}-`)).toBe(true);
    expect((await db.liveSession.findUniqueOrThrow({ where: { id } })).status).toBe('LIVE');
  });

  it('no-op for a session the vendor already ended', async () => {
    const disconnectedAt = secondsAgo(GRACE_SECONDS + 5);
    const id = await createSession({
      status: 'ENDED',
      endReason: 'VENDOR',
      endedAt: secondsAgo(1),
      encoderDisconnectedAt: disconnectedAt,
    });

    expect(await endIfStillDisconnected(deps, job(id, disconnectedAt))).toBe('noop');
    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.endReason).toBe('VENDOR');
    expect(await db.outboxEvent.count()).toBe(0);
  });
});
