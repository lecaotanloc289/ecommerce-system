import { LIVE_OUTBOX_AGGREGATE_TYPE, LiveOutboxEventSchema } from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';
import type { z } from 'zod';

export type LiveOutboxEventInput = z.input<typeof LiveOutboxEventSchema>;

/**
 * Builds an `outbox_events` row for a live-session event (Golden Rule #9). The payload is
 * validated against the core contract the worker parses with. Insert it in the SAME
 * transaction as the state change.
 */
export function liveOutboxRow(event: LiveOutboxEventInput): Prisma.OutboxEventCreateInput {
  const parsed = LiveOutboxEventSchema.parse(event);
  return {
    id: ulid(),
    aggregateType: LIVE_OUTBOX_AGGREGATE_TYPE,
    aggregateId: parsed.payload.liveSessionId,
    eventType: parsed.eventType,
    payload: parsed.payload,
  };
}
