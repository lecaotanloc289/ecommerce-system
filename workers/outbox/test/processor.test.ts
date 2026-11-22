import { FakeStreamProvider, StreamProviderError } from '@repo/streaming';
import { Worker, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createOutboxWorkerApp } from '../src/app.js';
import { OutboxDispatcher, type OutboxJobData } from '../src/dispatcher.js';
import { parseEnv } from '../src/env.js';
import { createGraceProcessor, type GraceJobData } from '../src/grace.js';
import { registerLiveSessionHandlers } from '../src/handlers/live-session.js';
import {
  createOutboxProcessor,
  HandlerRegistry,
  InvalidOutboxPayloadError,
  isPermanentFailure,
} from '../src/handlers/registry.js';
import { LiveEventValidationError } from '../src/live-events.js';
import {
  cappedExponentialBackoff,
  DEFAULT_JOB_OPTIONS,
  LIVE_DISCONNECT_GRACE_QUEUE,
  OUTBOX_QUEUE,
} from '../src/queues.js';
import {
  createSession,
  db,
  fixture,
  insertOutboxRow,
  newQueue,
  newRedis,
  resetDb,
  silentLogger,
  waitForJobState,
  waitUntil,
} from './helpers.js';

/** Provider whose createLiveInput always fails with the given error. */
class FailingProvider extends FakeStreamProvider {
  calls = 0;
  constructor(private readonly error: Error) {
    super();
  }
  override async createLiveInput(): Promise<{ liveInputId: string }> {
    this.calls += 1;
    throw this.error;
  }
}

let bull: Redis;
let redis: Redis;
let outboxQueue: Queue<OutboxJobData>;
let graceQueue: Queue<GraceJobData>;
let worker: Worker<OutboxJobData> | undefined;

/** Real BullMQ worker on the `outbox` queue, 3 attempts with a 10 ms fixed backoff. */
function startWorker(streamProvider: FakeStreamProvider): void {
  const registry = new HandlerRegistry();
  registerLiveSessionHandlers(registry, { db, redis, streamProvider, graceQueue });
  worker = new Worker<OutboxJobData>(
    OUTBOX_QUEUE,
    createOutboxProcessor({ db, registry, logger: silentLogger }),
    { connection: bull, concurrency: 2 },
  );
}

async function dispatch(): Promise<void> {
  const dispatcher = new OutboxDispatcher({
    db,
    queue: outboxQueue,
    logger: silentLogger,
    batchSize: 50,
    pollIntervalMs: 1_000,
  });
  await dispatcher.dispatchOnce();
}

beforeAll(() => {
  bull = newRedis({ bull: true });
  redis = newRedis();
  outboxQueue = newQueue<OutboxJobData>(OUTBOX_QUEUE, bull, {
    attempts: 3,
    backoff: { type: 'fixed', delay: 10 },
  });
  graceQueue = newQueue<GraceJobData>(LIVE_DISCONNECT_GRACE_QUEUE, bull);
});

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});

afterEach(async () => {
  await worker?.close();
  worker = undefined;
});

afterAll(async () => {
  await outboxQueue.close();
  await graceQueue.close();
  await bull.quit();
  await redis.quit();
  await db.$disconnect();
});

describe('outbox queue processor (real BullMQ)', () => {
  it('completes an event type with no registered handler', async () => {
    const id = await insertOutboxRow(
      'payment.captured',
      { paymentId: 'p1' },
      { aggregateType: 'Payment' },
    );
    startWorker(new FakeStreamProvider());
    await dispatch();

    expect(await waitForJobState(outboxQueue, id, ['completed', 'failed'])).toBe('completed');
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
  });

  it('non-retryable StreamProviderError fails once (UnrecoverableError) and records the error', async () => {
    const session = await createSession();
    const id = await insertOutboxRow('live_session.provision_requested', {
      liveSessionId: session,
    });
    const provider = new FailingProvider(
      new StreamProviderError('Cloudflare createLiveInput failed: HTTP 403', {
        status: 403,
        retryable: false,
      }),
    );
    startWorker(provider);
    await dispatch();

    expect(await waitForJobState(outboxQueue, id, ['failed'])).toBe('failed');
    const job = await outboxQueue.getJob(id);
    expect(job?.attemptsMade).toBe(1);
    expect(provider.calls).toBe(1);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('StreamProviderError: Cloudflare createLiveInput failed: HTTP 403');
  });

  it('retryable StreamProviderError is retried until attempts are exhausted', async () => {
    const session = await createSession();
    const id = await insertOutboxRow('live_session.provision_requested', {
      liveSessionId: session,
    });
    const provider = new FailingProvider(
      new StreamProviderError('Cloudflare createLiveInput failed: HTTP 503', {
        status: 503,
        retryable: true,
      }),
    );
    startWorker(provider);
    await dispatch();

    await waitUntil(
      '3 attempts',
      async () => (await outboxQueue.getJob(id))?.finishedOn !== undefined,
    );
    expect(await outboxQueue.getJobState(id)).toBe('failed');
    expect((await outboxQueue.getJob(id))?.attemptsMade).toBe(3);
    expect(provider.calls).toBe(3);
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id } })).attempts).toBe(3);
  });

  it('a payload that fails LiveOutboxEventSchema is a permanent failure', async () => {
    const id = await insertOutboxRow('live_session.ended', { liveSessionId: 'not-a-ulid' });
    startWorker(new FakeStreamProvider());
    await dispatch();

    expect(await waitForJobState(outboxQueue, id, ['failed'])).toBe('failed');
    expect((await outboxQueue.getJob(id))?.attemptsMade).toBe(1);
    const row = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/^InvalidOutboxPayloadError: Invalid live_session.ended payload/);
  });
});

describe('grace queue processor (real BullMQ)', () => {
  it('malformed job data fails once with UnrecoverableError', async () => {
    const graceWorker = new Worker<GraceJobData>(
      LIVE_DISCONNECT_GRACE_QUEUE,
      createGraceProcessor({ db, redis, graceQueue, logger: silentLogger }),
      { connection: bull },
    );
    try {
      const job = await graceQueue.add(
        'disconnect-grace',
        { liveSessionId: 'not-a-ulid', disconnectedAt: 'yesterday' },
        { attempts: 5, backoff: { type: 'fixed', delay: 10 } },
      );
      expect(await waitForJobState(graceQueue, job.id ?? '', ['failed'])).toBe('failed');
      expect((await graceQueue.getJob(job.id ?? ''))?.attemptsMade).toBe(1);
    } finally {
      await graceWorker.close();
    }
  });
});

describe('retry policy', () => {
  it('15 attempts; capped exponential backoff 2 s → … → 10 min; age-only retention', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(15);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ age: 86_400 });
    const delays = Array.from({ length: 14 }, (_, i) => cappedExponentialBackoff(i + 1));
    expect(delays.slice(0, 4)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(delays[8]).toBe(512_000);
    expect(delays.slice(9)).toEqual(Array(5).fill(600_000));
  });

  it('classifies permanent failures: invalid payload / non-retryable provider error only', () => {
    expect(isPermanentFailure(new InvalidOutboxPayloadError('bad'))).toBe(true);
    expect(
      isPermanentFailure(new StreamProviderError('403', { status: 403, retryable: false })),
    ).toBe(true);
    expect(
      isPermanentFailure(new StreamProviderError('503', { status: 503, retryable: true })),
    ).toBe(false);
    // A realtime-event validation failure is not the row's fault → retried, not dropped.
    expect(isPermanentFailure(new LiveEventValidationError('bad event'))).toBe(false);
    expect(isPermanentFailure(new Error('db down'))).toBe(false);
  });
});

describe('createOutboxWorkerApp (end to end)', () => {
  it('provision → ended: input created and stored, then retired; stop() shuts down cleanly', async () => {
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      OUTBOX_POLL_INTERVAL_MS: '20',
    });
    const provider = new FakeStreamProvider();
    const app = createOutboxWorkerApp(env, silentLogger, { streamProvider: provider });
    await app.start();

    const id = await createSession();
    await insertOutboxRow('live_session.provision_requested', { liveSessionId: id });
    await waitUntil('liveInputId stored', async () => {
      const s = await db.liveSession.findUniqueOrThrow({ where: { id } });
      return s.liveInputId !== null;
    });
    const { liveInputId } = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(provider.inspectLiveInput(liveInputId ?? '')?.isRetired).toBe(false);

    await db.liveSession.update({ where: { id }, data: { status: 'ENDED', endReason: 'VENDOR' } });
    await insertOutboxRow('live_session.ended', {
      liveSessionId: id,
      vendorId: fixture.vendorId,
      liveInputId,
      endReason: 'VENDOR',
    });
    await waitUntil(
      'input retired',
      () => provider.inspectLiveInput(liveInputId ?? '')?.isRetired === true,
    );

    await app.stop();
  });
});
