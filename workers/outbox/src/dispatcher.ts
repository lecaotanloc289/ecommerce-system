import type { prisma as prismaSingleton } from '@repo/db';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { Logger } from './logger.js';

export type Db = typeof prismaSingleton;

/**
 * Bounded claim transaction: wait at most 5 s for a pooled connection and hold the row locks at
 * most 10 s. The enqueue inside must fail fast when Redis is down (the app gives the dispatcher's
 * queue a connection with `enableOfflineQueue: false`) so the timeout is rarely the one to fire.
 */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

/** Job data on the `outbox` queue: a snapshot of the claimed `outbox_events` row. */
export const OutboxJobDataSchema = z.object({
  id: z.string().min(1),
  aggregateType: z.string(),
  aggregateId: z.string(),
  eventType: z.string(),
  payload: z.unknown(),
});
export type OutboxJobData = z.infer<typeof OutboxJobDataSchema>;

export interface OutboxDispatcherOptions {
  db: Db;
  queue: Queue<OutboxJobData>;
  logger: Logger;
  batchSize: number;
  pollIntervalMs: number;
  /**
   * Event types this worker has handlers for — the ONLY rows it claims. `@workers/jobs` dispatches
   * the same table (payments, refunds, emails, CRM); claiming its rows would mark them processed
   * here without running them.
   */
  eventTypes: readonly string[];
}

/**
 * Moves unprocessed `outbox_events` rows of the registered event types onto the BullMQ `outbox`
 * queue (rows of other types belong to `@workers/jobs` and are never touched).
 *
 * Each tick claims up to `batchSize` rows with `FOR UPDATE SKIP LOCKED` inside one transaction,
 * enqueues them (`jobId` = outbox id), then stamps `processed_at`. Concurrent dispatchers (N
 * replicas) never claim the same row. If the enqueue succeeds but the commit fails, the rows are
 * claimed again later and BullMQ dedupes them on `jobId`; handlers are idempotent regardless.
 */
export class OutboxDispatcher {
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly options: OutboxDispatcherOptions) {}

  /** One claim → enqueue → mark cycle. Returns the claimed outbox ids. */
  async dispatchOnce(): Promise<string[]> {
    const { db, queue, batchSize, eventTypes } = this.options;
    if (eventTypes.length === 0) return [];
    return db.$transaction(async (tx) => {
      const raw = await tx.$queryRaw<unknown[]>`
        SELECT id,
               aggregate_type AS "aggregateType",
               aggregate_id   AS "aggregateId",
               event_type     AS "eventType",
               payload
          FROM outbox_events
         WHERE processed_at IS NULL
           AND event_type = ANY(${[...eventTypes]}::text[])
         ORDER BY created_at, id
         LIMIT ${batchSize}
           FOR UPDATE SKIP LOCKED`;
      const rows = z.array(OutboxJobDataSchema).parse(raw);
      if (rows.length === 0) return [];

      await queue.addBulk(
        rows.map((row) => ({ name: row.eventType, data: row, opts: { jobId: row.id } })),
      );
      const ids = rows.map((row) => row.id);
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids } },
        data: { processedAt: new Date() },
      });
      return ids;
    }, TX_OPTIONS);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops polling and waits for the in-flight tick to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    const { logger, batchSize, pollIntervalMs } = this.options;
    while (this.running) {
      let claimed = 0;
      try {
        const ids = await this.dispatchOnce();
        claimed = ids.length;
        if (claimed > 0) logger.debug({ count: claimed }, 'outbox rows dispatched');
      } catch (err) {
        logger.error({ err }, 'outbox dispatch failed');
      }
      // stop() during the tick: exit now instead of sleeping a full interval.
      if (!this.running) break;
      // A full batch means there is probably more waiting — go again without sleeping.
      if (claimed < batchSize) await this.sleep(pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}
