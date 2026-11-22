import {
  LIVE_OUTBOX_AGGREGATE_TYPE,
  LiveEndReason,
  LiveOutboxEventSchema,
  LiveSessionIdSchema,
  LiveSessionStatus,
} from '@repo/core';
import { UnrecoverableError, type Job, type Processor, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Db } from './dispatcher.js';
import { expireEndedSessionKeys, publishLiveEvent, readPeakViewers } from './live-events.js';
import type { Logger } from './logger.js';
import { ulid } from './ulid.js';

export const GraceJobDataSchema = z.object({
  liveSessionId: LiveSessionIdSchema,
  disconnectedAt: z.iso.datetime(),
});
export type GraceJobData = z.input<typeof GraceJobDataSchema>;

export interface GraceDeps {
  db: Db;
  redis: Redis;
  graceQueue: Queue<GraceJobData>;
  logger: Logger;
}

/** BullMQ forbids `:` in custom job ids, so the plan's `grace:{id}:{ms}` uses `-` instead. */
export function graceJobId(liveSessionId: string, disconnectedAt: Date): string {
  return `grace-${liveSessionId}-${disconnectedAt.getTime()}`;
}

/** `PlatformSettings.liveDisconnectGraceSeconds` (tunable, never hardcoded). */
export async function readGraceSeconds(db: Db): Promise<number> {
  const settings = await db.platformSettings.findFirst({
    select: { liveDisconnectGraceSeconds: true },
  });
  if (!settings) throw new Error('PlatformSettings row is missing');
  return settings.liveDisconnectGraceSeconds;
}

/**
 * Schedules the grace check for one disconnect. Delay is measured from the disconnect itself, so
 * a late outbox delivery does not extend the grace period. One job per (session, disconnect
 * instant): duplicates dedupe on `jobId`.
 */
export async function scheduleGraceJob(
  deps: Pick<GraceDeps, 'db' | 'graceQueue' | 'logger'>,
  liveSessionId: string,
  disconnectedAt: Date,
  jobId: string = graceJobId(liveSessionId, disconnectedAt),
): Promise<void> {
  const graceSeconds = await readGraceSeconds(deps.db);
  const delay = Math.max(0, disconnectedAt.getTime() + graceSeconds * 1_000 - Date.now());
  await deps.graceQueue.add(
    'disconnect-grace',
    { liveSessionId, disconnectedAt: disconnectedAt.toISOString() },
    { jobId, delay },
  );
  deps.logger.info({ liveSessionId, jobId, delayMs: delay }, 'disconnect grace check scheduled');
}

export type GraceOutcome = 'ended' | 'replayed' | 'rescheduled' | 'noop';

/**
 * Plan §1.8 `LIVE → ENDED (DISCONNECT_TIMEOUT)`: one transaction with the guarded
 * `updateMany(status = LIVE, encoderConnectedAt IS NULL, encoderDisconnectedAt <= now − grace)`
 * plus the `live_session.ended` outbox row; Redis publish + 24 h TTLs after commit.
 * - reconnected / no longer LIVE → no-op;
 * - still disconnected but the latest disconnect has not yet aged past grace (a later disconnect,
 *   clock skew, or a raised grace setting) → re-schedule for that disconnect. The successor uses
 *   the jobId that disconnect's own outbox event uses (so they dedupe) — unless that is this very
 *   job, in which case it gets a unique suffix (an active jobId cannot be re-added);
 * - already ended by this job (crash after commit) → re-publish (at-least-once).
 */
export async function endIfStillDisconnected(
  deps: GraceDeps,
  data: GraceJobData,
  currentJobId?: string,
): Promise<GraceOutcome> {
  const { redis, logger } = deps;
  const { liveSessionId } = GraceJobDataSchema.parse(data);
  const log = logger.child({ liveSessionId });

  const result = await inStage(log, 'transition', () => transition(deps, liveSessionId));

  if (result.kind === 'missing') {
    log.warn('grace check for unknown live session — ignoring');
    return 'noop';
  }

  if (result.kind === 'ended') {
    await inStage(log, 'publish', () => announceEnded(redis, liveSessionId, result.endedAt));
    log.info('live session ended after encoder disconnect grace period');
    return 'ended';
  }

  const { current } = result;
  if (
    current.status === LiveSessionStatus.ENDED &&
    current.endReason === LiveEndReason.DISCONNECT_TIMEOUT &&
    current.endedAt !== null
  ) {
    const { endedAt } = current;
    await inStage(log, 'publish', () => announceEnded(redis, liveSessionId, endedAt));
    return 'replayed';
  }
  if (
    current.status === LiveSessionStatus.LIVE &&
    current.encoderConnectedAt === null &&
    current.encoderDisconnectedAt !== null
  ) {
    const disconnectedAt = current.encoderDisconnectedAt;
    const successorId = graceJobId(liveSessionId, disconnectedAt);
    const isSelf =
      currentJobId !== undefined &&
      (currentJobId === successorId || currentJobId.startsWith(`${successorId}-`));
    await inStage(log, 'reschedule', () =>
      scheduleGraceJob(
        deps,
        liveSessionId,
        disconnectedAt,
        isSelf ? `${successorId}-${Date.now()}` : successorId,
      ),
    );
    return 'rescheduled';
  }
  log.info({ status: current.status }, 'encoder reconnected or session no longer LIVE — no-op');
  return 'noop';
}

type GraceStage = 'transition' | 'publish' | 'reschedule';

/** Runs one stage; on failure logs which stage failed and rethrows (BullMQ retries the job). */
async function inStage<T>(log: Logger, stage: GraceStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ stage, err }, 'grace job stage failed');
    throw err;
  }
}

/** The guarded §1.8 transition + outbox row, in one transaction. */
async function transition(deps: GraceDeps, liveSessionId: string) {
  const { db, redis } = deps;
  const graceSeconds = await readGraceSeconds(db);
  const redisPeak = await readPeakViewers(redis, liveSessionId);
  const now = new Date();
  const cutoff = new Date(now.getTime() - graceSeconds * 1_000);

  return db.$transaction(async (tx) => {
    const session = await tx.liveSession.findUnique({
      where: { id: liveSessionId },
      select: { vendorId: true, liveInputId: true, peakViewers: true },
    });
    if (!session) return { kind: 'missing' } as const;

    const { count } = await tx.liveSession.updateMany({
      where: {
        id: liveSessionId,
        status: LiveSessionStatus.LIVE,
        encoderConnectedAt: null,
        encoderDisconnectedAt: { lte: cutoff },
      },
      data: {
        status: LiveSessionStatus.ENDED,
        endedAt: now,
        endReason: LiveEndReason.DISCONNECT_TIMEOUT,
        peakViewers: Math.max(session.peakViewers, redisPeak),
      },
    });
    if (count === 0) {
      const current = await tx.liveSession.findUniqueOrThrow({
        where: { id: liveSessionId },
        select: {
          status: true,
          endReason: true,
          endedAt: true,
          encoderConnectedAt: true,
          encoderDisconnectedAt: true,
        },
      });
      return { kind: 'unchanged', current } as const;
    }

    const outbox = LiveOutboxEventSchema.parse({
      eventType: 'live_session.ended',
      payload: {
        liveSessionId,
        vendorId: session.vendorId,
        liveInputId: session.liveInputId,
        endReason: LiveEndReason.DISCONNECT_TIMEOUT,
      },
    });
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        aggregateType: LIVE_OUTBOX_AGGREGATE_TYPE,
        aggregateId: liveSessionId,
        eventType: outbox.eventType,
        payload: outbox.payload,
      },
    });
    return { kind: 'ended', endedAt: now } as const;
  });
}

async function announceEnded(redis: Redis, liveSessionId: string, endedAt: Date): Promise<void> {
  await publishLiveEvent(redis, {
    type: 'session.ended',
    sessionId: liveSessionId,
    endedAt: endedAt.toISOString(),
    endReason: LiveEndReason.DISCONNECT_TIMEOUT,
  });
  await expireEndedSessionKeys(redis, liveSessionId);
}

export function createGraceProcessor(deps: GraceDeps): Processor<GraceJobData> {
  return async (job: Job<GraceJobData>) => {
    const parsed = GraceJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      deps.logger.error(
        { jobId: job.id, stage: 'job-data', err: parsed.error },
        'malformed grace job data — not retrying',
      );
      throw new UnrecoverableError('Malformed grace job data');
    }
    await endIfStillDisconnected(deps, parsed.data, job.id);
  };
}
