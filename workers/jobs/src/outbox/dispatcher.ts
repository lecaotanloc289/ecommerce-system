import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from '@repo/db';
import { describeError, type Logger } from '../logger';
import { PermanentError } from './errors';
import type { OutboxHandler, Tx } from './handler';

// Timestamps: `outbox_events` columns are `timestamp(3)` WITHOUT time zone holding UTC wall-clock
// time (what Prisma writes and reads). Every SQL "now" below is therefore
// `(now() AT TIME ZONE 'UTC')`, so results do not depend on the session's `TimeZone` setting.

/**
 * `next_attempt_at` of a dead-lettered event (processed_at stays NULL). Far future instead of
 * `infinity` so Prisma can still read the row. Requeue by hand:
 * `UPDATE outbox_events SET attempts = 0, next_attempt_at = now() AT TIME ZONE 'UTC' WHERE id = '…'`.
 */
export const DEAD_LETTER_AT = new Date('9999-12-31T00:00:00.000Z');
const DEAD_LETTER_SQL = '9999-12-31 00:00:00';

export const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LEASE_MS = 5 * 60_000;
const DEFAULT_TX_TIMEOUT_MS = 60_000;
const TX_MAX_WAIT_MS = 10_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/** 5s, 10s, 20s, … capped at 1h (attempt = the attempt that just failed, from 1). */
export function exponentialBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS);
}

export interface DispatcherOptions {
  /** Max events claimed per poll. */
  batchSize: number;
  /** Events handled in parallel (each holds a DB connection while its handler runs). */
  concurrency: number;
  /** Idle wait between polls when the last batch was not full. */
  pollIntervalMs: number;
  /** Attempts before an event is dead-lettered. Default 10. */
  maxAttempts?: number;
  /** How long a claim hides an event from other dispatchers (crash recovery delay). Default 5 min. */
  leaseMs?: number;
  /** Upper bound for handling one event (Prisma interactive transaction timeout). Default 60s. */
  txTimeoutMs?: number;
  /** Delay before retrying after the given failed attempt. Default `exponentialBackoff`. */
  backoff?: (attempt: number) => number;
}

/** An event this dispatcher claimed; `attempts` (post-increment) is the ownership token. */
export interface ClaimedEvent {
  id: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

export type ProcessOutcome = 'processed' | 'retry' | 'dead-lettered' | 'skipped';

/**
 * Outbox dispatcher (Golden Rule #9, roadmap D10). Runs handlers in-process; see
 * `workers/jobs/CLAUDE.md` for the full semantics. In short:
 *
 * 1. **Claim** (one autocommit statement): `FOR UPDATE SKIP LOCKED` picks due events **of the
 *    registered types only** (the keys of `handlers`; rows of other types are never touched),
 *    oldest first, increments `attempts` and pushes `next_attempt_at` out by the lease, so no
 *    other dispatcher selects them.
 * 2. **Process** each claimed event in its own transaction: re-lock the row only if it is still
 *    unprocessed with the claimed `attempts` (else another dispatcher re-claimed it after the
 *    lease expired → skip), run the handler inside a savepoint, then mark `processed_at` in the
 *    same transaction. The row lock is held for the whole handler, so two dispatchers never run
 *    the same event concurrently.
 * 3. **Failure**: roll back to the savepoint (handler writes are discarded), store `last_error`
 *    and back off; a `PermanentError` or the last attempt dead-letters (`next_attempt_at` =
 *    `DEAD_LETTER_AT`, `processed_at` stays NULL). A crash mid-handler leaves the claim: the
 *    event is retried after the lease, and its attempt still counts.
 *
 * Delivery is at-least-once for side effects outside the DB (email, provider session) and
 * exactly-once for DB writes made through `ctx.tx`. Payload keys a handler declares as
 * `secretKeys` are removed from the row when it is processed or dead-lettered.
 */
export class OutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly txTimeoutMs: number;
  private readonly backoff: (attempt: number) => number;
  /** The only event types this dispatcher claims — the handler table is the single source. */
  private readonly eventTypes: string[];

  constructor(
    private readonly handlers: Readonly<Record<string, OutboxHandler>>,
    private readonly log: Logger,
    private readonly options: DispatcherOptions,
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.txTimeoutMs = options.txTimeoutMs ?? DEFAULT_TX_TIMEOUT_MS;
    this.backoff = options.backoff ?? exponentialBackoff;
    this.eventTypes = Object.keys(handlers).sort();
  }

  /** Poll until `signal` aborts; the in-flight batch finishes, unstarted claims are released. */
  async run(signal: AbortSignal): Promise<void> {
    const { batchSize, concurrency, pollIntervalMs } = this.options;
    this.log.info(
      {
        batchSize,
        concurrency,
        pollIntervalMs,
        maxAttempts: this.maxAttempts,
        leaseMs: this.leaseMs,
        eventTypes: this.eventTypes,
      },
      'outbox dispatcher started',
    );
    while (!signal.aborted) {
      let claimed = 0;
      try {
        claimed = await this.pollOnce(signal);
      } catch (error) {
        this.log.error({ err: describeError(error) }, 'outbox poll failed');
      }
      if (claimed < this.options.batchSize) {
        await sleep(this.options.pollIntervalMs, undefined, { signal }).catch(() => undefined);
      }
    }
    this.log.info('outbox dispatcher stopped');
  }

  /** One poll: claim a batch, process it. Returns the number of events claimed. */
  async pollOnce(signal?: AbortSignal): Promise<number> {
    const events = await this.claim();
    const queue = [...events];
    const unstarted: ClaimedEvent[] = [];
    const lanes = Array.from(
      { length: Math.min(this.options.concurrency, queue.length) },
      async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          if (signal?.aborted) unstarted.push(next);
          else await this.process(next);
        }
      },
    );
    await Promise.all(lanes);
    if (unstarted.length > 0) await this.release(unstarted);
    return events.length;
  }

  /** Claims up to `batchSize` due events of the registered types (class doc, step 1). */
  async claim(): Promise<ClaimedEvent[]> {
    if (this.eventTypes.length === 0) return [];
    const rows = await prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE outbox_events AS o
      SET attempts = o.attempts + 1,
          next_attempt_at = (now() AT TIME ZONE 'UTC')
            + interval '1 millisecond' * ${this.leaseMs}::float8
      FROM (
        SELECT id FROM outbox_events
        WHERE processed_at IS NULL
          AND next_attempt_at <= (now() AT TIME ZONE 'UTC')
          AND event_type = ANY(${this.eventTypes}::text[])
        ORDER BY created_at, id
        LIMIT ${this.options.batchSize}::int
        FOR UPDATE SKIP LOCKED
      ) AS due
      WHERE o.id = due.id
      RETURNING o.id, o.event_type AS "eventType", o.payload, o.attempts, o.created_at AS "createdAt"`;
    return rows.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  /** Handles one claimed event (class doc, steps 2-3). Never throws. */
  async process(event: ClaimedEvent): Promise<ProcessOutcome> {
    const log = this.log.child({
      outboxEventId: event.id,
      eventType: event.eventType,
      attempt: event.attempts,
    });
    try {
      return await prisma.$transaction(
        async (tx) => {
          const owned = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM outbox_events
            WHERE id = ${event.id} AND processed_at IS NULL AND attempts = ${event.attempts}::int
            FOR UPDATE SKIP LOCKED`;
          if (owned.length === 0) {
            log.warn(
              'outbox claim lost (re-claimed after the lease or already processed); skipped',
            );
            return 'skipped';
          }
          if (event.attempts > this.maxAttempts) {
            // Only reachable when the previous (last) attempt died without recording its outcome.
            return this.fail(tx, event, new Error('worker stopped during the last attempt'), log);
          }

          await tx.$executeRaw`SAVEPOINT outbox_handler`;
          try {
            const handler = this.handlerFor(event.eventType);
            // Unreachable: claim() only selects registered types.
            if (!handler) throw new Error(`no handler for event type "${event.eventType}"`);
            await handler.handle(event.payload, {
              tx,
              log,
              event: { id: event.id, eventType: event.eventType, attempts: event.attempts },
            });
          } catch (error) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT outbox_handler`;
            return this.fail(tx, event, error, log);
          }
          await tx.$executeRaw`
            UPDATE outbox_events
            SET processed_at = (now() AT TIME ZONE 'UTC'),
                payload = payload - ${this.secretKeys(event)}::text[]
            WHERE id = ${event.id}`;
          log.debug('outbox event processed');
          return 'processed';
        },
        { timeout: this.txTimeoutMs, maxWait: TX_MAX_WAIT_MS },
      );
    } catch (error) {
      // Transaction-level failure (timeout, lost connection): nothing was recorded; the claim's
      // lease delays the retry and the attempt still counts. Leave a trace for operators.
      const lastError = `transaction failed: ${describeError(error)}`;
      log.error({ err: lastError, retryInMs: this.leaseMs }, 'outbox event retried after lease');
      await prisma.$executeRaw`
        UPDATE outbox_events SET last_error = ${lastError}
        WHERE id = ${event.id} AND attempts = ${event.attempts}::int AND processed_at IS NULL`.catch(
        () => undefined,
      );
      return 'retry';
    }
  }

  private async fail(
    tx: Tx,
    event: ClaimedEvent,
    error: unknown,
    log: Logger,
  ): Promise<ProcessOutcome> {
    const lastError = describeError(error);
    if (error instanceof PermanentError || event.attempts >= this.maxAttempts) {
      await tx.$executeRaw`
        UPDATE outbox_events
        SET last_error = ${lastError}, next_attempt_at = ${DEAD_LETTER_SQL}::timestamp,
            payload = payload - ${this.secretKeys(event)}::text[]
        WHERE id = ${event.id}`;
      log.error(
        { err: lastError, permanent: error instanceof PermanentError },
        'outbox event dead-lettered',
      );
      return 'dead-lettered';
    }
    const retryInMs = this.backoff(event.attempts);
    await tx.$executeRaw`
      UPDATE outbox_events
      SET last_error = ${lastError},
          next_attempt_at = (now() AT TIME ZONE 'UTC')
            + interval '1 millisecond' * ${retryInMs}::float8
      WHERE id = ${event.id}`;
    log.warn({ err: lastError, retryInMs }, 'outbox event failed; will retry');
    return 'retry';
  }

  private handlerFor(eventType: string): OutboxHandler | undefined {
    return Object.hasOwn(this.handlers, eventType) ? this.handlers[eventType] : undefined;
  }

  /** Payload keys to scrub once the event is done (processed or dead-lettered). */
  private secretKeys(event: ClaimedEvent): string[] {
    return [...(this.handlerFor(event.eventType)?.secretKeys ?? [])];
  }

  /** Gives claimed-but-unstarted events back (shutdown): due now, the claim's attempt undone. */
  private async release(events: ClaimedEvent[]): Promise<void> {
    for (const event of events) {
      await prisma.$executeRaw`
        UPDATE outbox_events
        SET attempts = attempts - 1, next_attempt_at = (now() AT TIME ZONE 'UTC')
        WHERE id = ${event.id} AND attempts = ${event.attempts}::int AND processed_at IS NULL`;
    }
    this.log.info({ released: events.length }, 'released unstarted outbox events');
  }
}
