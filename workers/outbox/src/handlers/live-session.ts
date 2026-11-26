import {
  LIVE_OUTBOX_EVENT_TYPES,
  LiveOutboxEventSchema,
  LiveSessionStatus,
  type LiveOutboxEvent,
} from '@repo/core';
import type { StreamProvider } from '@repo/streaming';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Db, OutboxJobData } from '../dispatcher.js';
import { scheduleGraceJob, type GraceJobData } from '../grace.js';
import { liveKeys, PROVISION_PENDING_TTL_SECONDS, publishLiveEvent } from '../live-events.js';
import type { Logger } from '../logger.js';
import { InvalidOutboxPayloadError, type HandlerRegistry } from './registry.js';

export interface LiveSessionHandlerDeps {
  db: Db;
  redis: Redis;
  streamProvider: StreamProvider;
  graceQueue: Queue<GraceJobData>;
}

type EventOf<T extends LiveOutboxEvent['eventType']> = Extract<LiveOutboxEvent, { eventType: T }>;

const ACTIVE_STATUSES: LiveSessionStatus[] = [LiveSessionStatus.SCHEDULED, LiveSessionStatus.LIVE];
const isActive = (status: LiveSessionStatus): boolean => ACTIVE_STATUSES.includes(status);

/** Registers a handler for every `live_session.*` outbox event type. */
export function registerLiveSessionHandlers(
  registry: HandlerRegistry,
  deps: LiveSessionHandlerDeps,
): void {
  for (const eventType of LIVE_OUTBOX_EVENT_TYPES) {
    registry.register(eventType, (row, logger) => handleLiveSessionEvent(deps, row, logger));
  }
}

/**
 * Parses the row with core's `LiveOutboxEventSchema` (failure = `InvalidOutboxPayloadError`,
 * permanent) and routes it.
 */
export async function handleLiveSessionEvent(
  deps: LiveSessionHandlerDeps,
  row: OutboxJobData,
  logger: Logger,
): Promise<void> {
  const parsed = LiveOutboxEventSchema.safeParse({
    eventType: row.eventType,
    payload: row.payload,
  });
  if (!parsed.success) {
    throw new InvalidOutboxPayloadError(
      `Invalid ${row.eventType} payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  const event = parsed.data;
  switch (event.eventType) {
    case 'live_session.provision_requested':
      return provision(deps, event, logger);
    case 'live_session.started':
      // Placeholder for follower notifications (spec: future work).
      logger.info({ vendorId: event.payload.vendorId }, 'live session started');
      return;
    case 'live_session.encoder_disconnected':
      return scheduleGraceJob(
        { ...deps, logger },
        event.payload.liveSessionId,
        new Date(event.payload.disconnectedAt),
      );
    case 'live_session.ended':
    case 'live_session.cancelled':
      return retire(deps, event.payload.liveInputId, logger);
  }
}

/**
 * Creates the provider live input and stores its id, without leaking inputs:
 *
 * - The new id goes into the Redis SET `live:provision-pending:{id}` *before* the DB write, so if
 *   the DB write fails or the worker crashes, the retry adopts that input instead of creating a
 *   second one.
 * - Any pending id that did not end up stored (session cancelled/ended meanwhile, or a concurrent
 *   attempt stored another id) is retired, and only removed from the SET once retired. A failed
 *   retire rethrows, so the job retries the retire of that same id.
 *
 * Remaining window: a crash between `createLiveInput` returning and the SADD (see CLAUDE.md).
 */
async function provision(
  deps: LiveSessionHandlerDeps,
  event: EventOf<'live_session.provision_requested'>,
  logger: Logger,
): Promise<void> {
  const { db, redis, streamProvider } = deps;
  const { liveSessionId } = event.payload;
  const pendingKey = liveKeys.provisionPending(liveSessionId);

  const session = await db.liveSession.findUnique({
    where: { id: liveSessionId },
    select: { status: true, liveInputId: true },
  });
  const pending = await redis.smembers(pendingKey);
  let storedId = session?.liveInputId ?? null;
  const shouldProvision = session !== null && isActive(session.status) && storedId === null;

  if (shouldProvision) {
    let candidate = pending[0];
    if (candidate === undefined) {
      ({ liveInputId: candidate } = await streamProvider.createLiveInput({ liveSessionId }));
      await redis
        .multi()
        .sadd(pendingKey, candidate)
        .expire(pendingKey, PROVISION_PENDING_TTL_SECONDS)
        .exec();
      pending.push(candidate);
    } else {
      logger.info({ liveInputId: candidate }, 'adopting live input from an earlier attempt');
    }
    const { count } = await db.liveSession.updateMany({
      where: { id: liveSessionId, liveInputId: null, status: { in: ACTIVE_STATUSES } },
      data: { liveInputId: candidate },
    });
    if (count === 1) {
      storedId = candidate;
      logger.info({ liveInputId: candidate }, 'live input provisioned');
    } else {
      const current = await db.liveSession.findUnique({
        where: { id: liveSessionId },
        select: { liveInputId: true },
      });
      storedId = current?.liveInputId ?? null;
    }
  } else if (!session) {
    logger.warn('provision requested for unknown live session');
  } else if (!isActive(session.status)) {
    logger.info({ status: session.status }, 'live session no longer active — skipping provision');
  }

  for (const liveInputId of pending) {
    if (liveInputId !== storedId) {
      await streamProvider.retireLiveInput(liveInputId); // throws → retried, id stays pending
      logger.info({ liveInputId }, 'retired unused live input (lost provisioning race)');
    }
    await redis.srem(pendingKey, liveInputId);
  }

  if (storedId !== null && session !== null && isActive(session.status)) {
    // Also re-published on a replay (stored id, publish lost) — subscribers treat it idempotently.
    await publishLiveEvent(redis, { type: 'session.provisioned', sessionId: liveSessionId });
  }
}

async function retire(
  deps: LiveSessionHandlerDeps,
  liveInputId: string | null,
  logger: Logger,
): Promise<void> {
  if (liveInputId === null) {
    logger.info('no live input to retire');
    return;
  }
  await deps.streamProvider.retireLiveInput(liveInputId);
  logger.info({ liveInputId }, 'live input retired');
}
