import { isStreamProviderError } from '@repo/streaming';
import { UnrecoverableError, type Job, type Processor } from 'bullmq';
import { OutboxJobDataSchema, type Db, type OutboxJobData } from '../dispatcher.js';
import type { Logger } from '../logger.js';

/** Handles one outbox row. Must be idempotent: a row may be delivered more than once. */
export type OutboxHandler = (event: OutboxJobData, logger: Logger) => Promise<void>;

/** eventType → handler. Domains register their own (`registerLiveSessionHandlers`, …). */
export class HandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(eventType: string, handler: OutboxHandler): void {
    if (this.handlers.has(eventType)) {
      throw new Error(`Outbox handler already registered for ${eventType}`);
    }
    this.handlers.set(eventType, handler);
  }

  get(eventType: string): OutboxHandler | undefined {
    return this.handlers.get(eventType);
  }

  /** Registered event types — the dispatcher claims only these. */
  eventTypes(): string[] {
    return [...this.handlers.keys()];
  }
}

/**
 * Thrown by a handler when the outbox row itself is unusable (payload fails its schema). Retrying
 * cannot fix the row, so it is permanent. Other validation errors (e.g. building a realtime event)
 * are NOT wrapped in this and stay retryable.
 */
export class InvalidOutboxPayloadError extends Error {
  override readonly name = 'InvalidOutboxPayloadError';
}

/**
 * Failures that can never succeed on retry: a non-retryable provider error (4xx, invalid id) or
 * an invalid outbox payload. Everything else is retried with backoff.
 */
export function isPermanentFailure(err: unknown): boolean {
  if (isStreamProviderError(err)) return !err.retryable;
  return err instanceof InvalidOutboxPayloadError;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

const LAST_ERROR_MAX_LENGTH = 1_000;

export interface OutboxProcessorDeps {
  db: Db;
  registry: HandlerRegistry;
  logger: Logger;
}

/**
 * BullMQ processor for the `outbox` queue: route by `eventType`; unknown types complete (so other
 * domains can add handlers later). Every failure increments `outbox_events.attempts` and records
 * `last_error`; permanent failures are rethrown as `UnrecoverableError` so BullMQ stops retrying.
 */
export function createOutboxProcessor(deps: OutboxProcessorDeps): Processor<OutboxJobData> {
  const { db, registry, logger } = deps;
  return async (job: Job<OutboxJobData>) => {
    const parsed = OutboxJobDataSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error(
        { jobId: job.id, stage: 'job-data', err: parsed.error },
        'malformed outbox job data',
      );
      throw new UnrecoverableError('Malformed outbox job data');
    }
    const event = parsed.data;
    const log = logger.child({
      outboxId: event.id,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      attempt: job.attemptsMade + 1,
    });

    const handler = registry.get(event.eventType);
    if (!handler) {
      log.info('no handler for outbox event type — completing');
      return;
    }

    try {
      await handler(event, log);
    } catch (err) {
      const message = errorMessage(err);
      await db.outboxEvent
        .updateMany({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError: message.slice(0, LAST_ERROR_MAX_LENGTH) },
        })
        .catch((recordErr: unknown) =>
          log.error({ err: recordErr }, 'failed to record outbox failure'),
        );
      if (isPermanentFailure(err)) {
        log.error({ stage: 'handler', err }, 'outbox handler failed permanently — not retrying');
        throw new UnrecoverableError(message);
      }
      log.warn({ stage: 'handler', err }, 'outbox handler failed — will retry');
      throw err;
    }
  };
}
