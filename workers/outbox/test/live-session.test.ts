import { LiveEventSchema } from '@repo/core';
import { FakeStreamProvider, StreamProviderError } from '@repo/streaming';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutboxJobData } from '../src/dispatcher.js';
import { graceJobId, type GraceJobData } from '../src/grace.js';
import {
  handleLiveSessionEvent,
  type LiveSessionHandlerDeps,
} from '../src/handlers/live-session.js';
import { InvalidOutboxPayloadError } from '../src/handlers/registry.js';
import { liveKeys } from '../src/live-events.js';
import { LIVE_DISCONNECT_GRACE_QUEUE } from '../src/queues.js';
import { ulid } from '../src/ulid.js';
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
let provider: FakeStreamProvider;

function deps(streamProvider = provider): LiveSessionHandlerDeps {
  return { db, redis, streamProvider, graceQueue };
}

function row(eventType: string, payload: Record<string, string | null>): OutboxJobData {
  return {
    id: ulid(),
    aggregateType: 'LiveSession',
    aggregateId: payload.liveSessionId ?? '',
    eventType,
    payload,
  };
}

/** Fake provider that runs `during` between creating the input and returning (a racing writer). */
class RacingProvider extends FakeStreamProvider {
  constructor(private readonly during: (liveInputId: string) => Promise<void>) {
    super();
  }
  override async createLiveInput(input: { liveSessionId: string }) {
    const created = await super.createLiveInput(input);
    await this.during(created.liveInputId);
    return created;
  }
}

/** Racing provider whose first `failRetires` retire calls fail with a retryable error. */
class FlakyRetireProvider extends RacingProvider {
  creates = 0;
  constructor(
    during: (liveInputId: string) => Promise<void>,
    private failRetires: number,
  ) {
    super(during);
  }
  override async createLiveInput(input: { liveSessionId: string }) {
    this.creates += 1;
    return super.createLiveInput(input);
  }
  override async retireLiveInput(liveInputId: string): Promise<void> {
    if (this.failRetires > 0) {
      this.failRetires -= 1;
      throw new StreamProviderError('Fake retire failed: HTTP 503', {
        status: 503,
        retryable: true,
      });
    }
    return super.retireLiveInput(liveInputId);
  }
}

/** Counts provider-side input creations. */
class CountingProvider extends FakeStreamProvider {
  creates = 0;
  override async createLiveInput(input: { liveSessionId: string }) {
    this.creates += 1;
    return super.createLiveInput(input);
  }
}

beforeAll(() => {
  bull = newRedis({ bull: true });
  redis = newRedis();
  graceQueue = newQueue<GraceJobData>(LIVE_DISCONNECT_GRACE_QUEUE, bull);
});

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  provider = new FakeStreamProvider();
});

afterAll(async () => {
  await graceQueue.close();
  await bull.quit();
  await redis.quit();
  await db.$disconnect();
});

describe('live_session.provision_requested', () => {
  it('creates the live input, stores it and publishes session.provisioned', async () => {
    const id = await createSession();
    const sub = await subscribe(liveKeys.events(id));

    await handleLiveSessionEvent(
      deps(),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).not.toBeNull();
    expect(provider.inspectLiveInput(session.liveInputId ?? '')).toEqual({
      liveSessionId: id,
      isRetired: false,
    });
    await waitUntil('provisioned event', () => sub.messages.length === 1);
    expect(LiveEventSchema.parse(sub.messages[0])).toEqual({
      type: 'session.provisioned',
      sessionId: id,
    });
    await sub.close();
  });

  it('replay with an input already stored creates nothing new and re-publishes', async () => {
    const id = await createSession({ liveInputId: 'existinginput1' });
    const sub = await subscribe(liveKeys.events(id));
    const counting = new CountingProvider();

    await handleLiveSessionEvent(
      deps(counting),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    expect(counting.creates).toBe(0);
    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).toBe('existinginput1');
    await waitUntil('provisioned event', () => sub.messages.length === 1);
    await sub.close();
  });

  it('skips a session that was cancelled before provisioning', async () => {
    const id = await createSession({ status: 'CANCELLED' });
    const counting = new CountingProvider();

    await handleLiveSessionEvent(
      deps(counting),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).toBeNull();
    expect(counting.creates).toBe(0);
  });

  it('race: session cancelled while the provider call was in flight → new input retired', async () => {
    const id = await createSession();
    const racing = new RacingProvider(async () => {
      await db.liveSession.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    await handleLiveSessionEvent(
      deps(racing),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).toBeNull();
    const { liveInputId } = await racing.createLiveInput({ liveSessionId: id });
    expect(racing.inspectLiveInput(liveInputId)?.isRetired).toBe(true);
  });

  it('race: a concurrent attempt stored a different input → ours retired, theirs kept', async () => {
    const id = await createSession();
    const racing = new RacingProvider(async () => {
      await db.liveSession.update({ where: { id }, data: { liveInputId: 'otherattempt1' } });
    });

    await handleLiveSessionEvent(
      deps(racing),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).toBe('otherattempt1');
    const { liveInputId } = await racing.createLiveInput({ liveSessionId: id });
    expect(racing.inspectLiveInput(liveInputId)?.isRetired).toBe(true);
  });

  it('race: a concurrent attempt stored the same input id → not retired', async () => {
    const id = await createSession();
    const racing = new RacingProvider(async (liveInputId) => {
      await db.liveSession.update({ where: { id }, data: { liveInputId } });
    });

    await handleLiveSessionEvent(
      deps(racing),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    const session = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(session.liveInputId).not.toBeNull();
    expect(racing.inspectLiveInput(session.liveInputId ?? '')?.isRetired).toBe(false);
  });
});

describe('provision: no leaked inputs across attempts', () => {
  it('race-loss retire failure rethrows and keeps the id pending; the retry retires that id', async () => {
    const id = await createSession();
    const provider = new FlakyRetireProvider(async () => {
      await db.liveSession.update({ where: { id }, data: { status: 'CANCELLED' } });
    }, 1);
    const event = row('live_session.provision_requested', { liveSessionId: id });

    await expect(handleLiveSessionEvent(deps(provider), event, silentLogger)).rejects.toThrow(
      /HTTP 503/,
    );
    const [pendingId] = await redis.smembers(liveKeys.provisionPending(id));
    expect(pendingId).toBeDefined();
    expect(provider.inspectLiveInput(pendingId ?? '')?.isRetired).toBe(false);

    await handleLiveSessionEvent(deps(provider), event, silentLogger); // BullMQ retry

    expect(provider.inspectLiveInput(pendingId ?? '')?.isRetired).toBe(true);
    expect(await redis.smembers(liveKeys.provisionPending(id))).toEqual([]);
    expect(provider.creates).toBe(1); // the retry did not create another input
    expect((await db.liveSession.findUniqueOrThrow({ where: { id } })).liveInputId).toBeNull();
  });

  it('retry after a failed DB write adopts the pending input instead of creating a second one', async () => {
    const id = await createSession();
    const counting = new CountingProvider();
    // State left by an attempt that created the input, recorded it, then failed before the DB write.
    await redis.sadd(liveKeys.provisionPending(id), 'pendinginput1');

    await handleLiveSessionEvent(
      deps(counting),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );

    expect(counting.creates).toBe(0);
    expect((await db.liveSession.findUniqueOrThrow({ where: { id } })).liveInputId).toBe(
      'pendinginput1',
    );
    expect(await redis.smembers(liveKeys.provisionPending(id))).toEqual([]);
  });

  it('happy path leaves no pending ids behind', async () => {
    const id = await createSession();
    await handleLiveSessionEvent(
      deps(),
      row('live_session.provision_requested', { liveSessionId: id }),
      silentLogger,
    );
    expect(await redis.exists(liveKeys.provisionPending(id))).toBe(0);
  });
});

describe('live_session.ended / cancelled', () => {
  it('retires the live input on ended', async () => {
    const id = await createSession({ status: 'ENDED' });
    const { liveInputId } = await provider.createLiveInput({ liveSessionId: id });

    await handleLiveSessionEvent(
      deps(),
      row('live_session.ended', {
        liveSessionId: id,
        vendorId: fixture.vendorId,
        liveInputId,
        endReason: 'VENDOR',
      }),
      silentLogger,
    );

    expect(provider.inspectLiveInput(liveInputId)?.isRetired).toBe(true);
  });

  it('retires the live input on cancelled; no-op when liveInputId is null', async () => {
    const id = await createSession({ status: 'CANCELLED' });
    const { liveInputId } = await provider.createLiveInput({ liveSessionId: id });

    await handleLiveSessionEvent(
      deps(),
      row('live_session.cancelled', { liveSessionId: id, liveInputId }),
      silentLogger,
    );
    expect(provider.inspectLiveInput(liveInputId)?.isRetired).toBe(true);

    await expect(
      handleLiveSessionEvent(
        deps(),
        row('live_session.cancelled', { liveSessionId: id, liveInputId: null }),
        silentLogger,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('live_session.encoder_disconnected', () => {
  it('schedules one delayed grace job per disconnect (duplicates dedupe)', async () => {
    const id = await createSession({ status: 'LIVE' });
    const disconnectedAt = new Date(Date.now() - 5_000);
    const event = row('live_session.encoder_disconnected', {
      liveSessionId: id,
      disconnectedAt: disconnectedAt.toISOString(),
    });

    await handleLiveSessionEvent(deps(), event, silentLogger);
    await handleLiveSessionEvent(deps(), event, silentLogger);

    const jobId = graceJobId(id, disconnectedAt);
    expect(jobId).toBe(`grace-${id}-${disconnectedAt.getTime()}`);
    expect(await graceQueue.getDelayedCount()).toBe(1);
    const job = await graceQueue.getJob(jobId);
    expect(job?.data).toEqual({ liveSessionId: id, disconnectedAt: disconnectedAt.toISOString() });
    // Delay counts from the disconnect itself: ~grace − 5 s.
    expect(job?.opts.delay).toBeGreaterThan((GRACE_SECONDS - 6) * 1_000);
    expect(job?.opts.delay).toBeLessThanOrEqual((GRACE_SECONDS - 5) * 1_000);
  });
});

describe('live_session.started and malformed payloads', () => {
  it('started is a logged no-op', async () => {
    const id = await createSession({ status: 'LIVE' });
    await expect(
      handleLiveSessionEvent(
        deps(),
        row('live_session.started', {
          liveSessionId: id,
          vendorId: fixture.vendorId,
          startedAt: new Date().toISOString(),
        }),
        silentLogger,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a payload that does not match its eventType (InvalidOutboxPayloadError)', async () => {
    await expect(
      handleLiveSessionEvent(
        deps(),
        row('live_session.ended', { liveSessionId: ulid() }),
        silentLogger,
      ),
    ).rejects.toBeInstanceOf(InvalidOutboxPayloadError);
  });
});
