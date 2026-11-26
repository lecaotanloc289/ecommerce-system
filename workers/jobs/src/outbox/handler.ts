import type { Prisma } from '@repo/db';
import type { z } from 'zod';
import type { Logger } from '../logger';
import { PermanentError } from './errors';

/** The interactive transaction an event is handled in (it also holds the outbox row lock). */
export type Tx = Prisma.TransactionClient;

export interface OutboxEventInfo {
  id: string;
  eventType: string;
  /** Delivery attempt number, starting at 1 (incremented when the event is claimed). */
  attempts: number;
}

export interface HandlerContext {
  /**
   * Same transaction that marks the event processed: DB writes made through it commit
   * atomically with the "processed" mark, or roll back when the handler throws.
   */
  tx: Tx;
  log: Logger;
  event: OutboxEventInfo;
}

/** A handler for one event type. Must be idempotent: an event may be delivered more than once. */
export interface OutboxHandler {
  handle(payload: unknown, ctx: HandlerContext): Promise<void>;
  /**
   * Top-level payload keys holding secrets (e.g. the raw invitation token). The dispatcher removes
   * them from the stored payload in the same transaction that marks the event processed or
   * dead-lettered; they stay only while a retry may still need them.
   */
  readonly secretKeys?: readonly string[];
}

/** Binds a payload schema to its handler; an invalid payload is a permanent failure. */
export function defineHandler<S extends z.ZodType>(
  schema: S,
  handle: (payload: z.output<S>, ctx: HandlerContext) => Promise<void>,
  options: { secretKeys?: readonly string[] } = {},
): OutboxHandler {
  return {
    ...(options.secretKeys ? { secretKeys: options.secretKeys } : {}),
    async handle(payload, ctx) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
        throw new PermanentError(`invalid ${ctx.event.eventType} payload (${fields})`);
      }
      await handle(parsed.data, ctx);
    },
  };
}
