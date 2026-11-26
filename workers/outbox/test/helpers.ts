import { LIVE_OUTBOX_AGGREGATE_TYPE } from '@repo/core';
import { prisma } from '@repo/db';
import { Queue, type DefaultJobOptions, type JobState } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { inject } from 'vitest';
import { ulid } from '../src/ulid.js';

export const db = prisma;
export const silentLogger = pino({ level: 'silent' });
export const GRACE_SECONDS = 120;

export const fixture = { userId: ulid(), vendorId: ulid() };

export function newRedis(options: { bull?: boolean } = {}): Redis {
  return new Redis(inject('redisUrl'), options.bull ? { maxRetriesPerRequest: null } : {});
}

export function newQueue<T>(
  name: string,
  connection: Redis,
  defaultJobOptions?: DefaultJobOptions,
): Queue<T> {
  return new Queue<T>(name, {
    connection,
    ...(defaultJobOptions ? { defaultJobOptions } : {}),
  });
}

/** Empties every table this worker touches and re-creates the user/vendor/settings fixtures. */
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE outbox_events, live_session_products, live_sessions, vendors, users, platform_settings CASCADE',
  );
  await db.user.create({ data: { id: fixture.userId, name: 'Vendor Owner' } });
  await db.vendor.create({
    data: {
      id: fixture.vendorId,
      ownerId: fixture.userId,
      slug: `vendor-${fixture.vendorId.toLowerCase()}`,
      displayName: 'Test Vendor',
      status: 'ACTIVE',
    },
  });
  await db.platformSettings.create({
    data: {
      id: ulid(),
      supportedCurrencies: ['VND', 'USD'],
      liveDisconnectGraceSeconds: GRACE_SECONDS,
    },
  });
}

type SessionOverrides = Partial<{
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
  liveInputId: string | null;
  encoderConnectedAt: Date | null;
  encoderDisconnectedAt: Date | null;
  startedAt: Date | null;
  endReason: 'VENDOR' | 'DISCONNECT_TIMEOUT' | 'TERMINATED' | null;
  endedAt: Date | null;
  peakViewers: number;
}>;

export async function createSession(overrides: SessionOverrides = {}): Promise<string> {
  const id = ulid();
  await db.liveSession.create({
    data: {
      id,
      vendorId: fixture.vendorId,
      createdById: fixture.userId,
      idempotencyKey: ulid(),
      title: 'Test live',
      ...overrides,
    },
  });
  return id;
}

export async function insertOutboxRow(
  eventType: string,
  payload: Record<string, string | null>,
  options: { aggregateType?: string; aggregateId?: string; createdAt?: Date } = {},
): Promise<string> {
  const id = ulid();
  await db.outboxEvent.create({
    data: {
      id,
      aggregateType: options.aggregateType ?? LIVE_OUTBOX_AGGREGATE_TYPE,
      aggregateId: options.aggregateId ?? payload.liveSessionId ?? id,
      eventType,
      payload,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  return id;
}

/** Subscribes to a channel; `messages` fills as JSON messages arrive. */
export async function subscribe(
  channel: string,
): Promise<{ messages: unknown[]; close: () => Promise<void> }> {
  const sub = newRedis();
  const messages: unknown[] = [];
  sub.on('message', (_channel: string, message: string) => {
    messages.push(JSON.parse(message));
  });
  await sub.subscribe(channel);
  return {
    messages,
    close: async () => {
      await sub.quit();
    },
  };
}

export async function waitUntil(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function waitForJobState(
  queue: Queue,
  jobId: string,
  states: JobState[],
): Promise<JobState | 'unknown'> {
  let state: JobState | 'unknown' = 'unknown';
  await waitUntil(`job ${jobId} in ${states.join('/')}`, async () => {
    state = await queue.getJobState(jobId);
    return state !== 'unknown' && states.includes(state);
  });
  return state;
}
