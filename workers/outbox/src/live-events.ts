import { LiveEventSchema } from '@repo/core';
import type { Redis } from 'ioredis';
import type { z } from 'zod';

/** Redis keys shared with the server (plan §1.5). */
export const liveKeys = {
  events: (id: string) => `live:${id}:events`,
  chat: (id: string) => `live:${id}:chat`,
  viewers: (id: string) => `live:${id}:viewers`,
  peak: (id: string) => `live:${id}:peak`,
  muted: (id: string) => `live:${id}:muted`,
  /**
   * Worker-only SET of live input ids created at the provider but not yet confirmed as stored on
   * the session (or lost the race and still need retiring). See handlers/live-session.ts.
   */
  provisionPending: (id: string) => `live:provision-pending:${id}`,
};

/** Outlives the full retry window (~67 min) by a wide margin; ids left after that need ops. */
export const PROVISION_PENDING_TTL_SECONDS = 7 * 86_400;

/** A realtime event failed core's `LiveEventSchema` — a bug in the event builder, not the row. */
export class LiveEventValidationError extends Error {
  override readonly name = 'LiveEventValidationError';
}

/** Chat, viewers, peak and muted survive 24 h after a session ends (plan §1.5). */
export const ENDED_SESSION_KEY_TTL_SECONDS = 86_400;

export type LiveEventInput = z.input<typeof LiveEventSchema> & { sessionId: string };

/**
 * Validates against core's `LiveEventSchema`, then publishes to `live:{sessionId}:events`.
 * Validation failure throws `LiveEventValidationError` (retryable like any other error — it is
 * not the outbox row's fault).
 */
export async function publishLiveEvent(redis: Redis, event: LiveEventInput): Promise<void> {
  const parsed = LiveEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new LiveEventValidationError(`Invalid ${event.type} event: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  await redis.publish(liveKeys.events(event.sessionId), JSON.stringify(parsed.data));
}

/** `live:{id}:peak` as a non-negative int; missing or garbage → 0. */
export async function readPeakViewers(redis: Redis, sessionId: string): Promise<number> {
  const raw = await redis.get(liveKeys.peak(sessionId));
  const value = raw === null ? 0 : Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export async function expireEndedSessionKeys(redis: Redis, sessionId: string): Promise<void> {
  await redis
    .multi()
    .expire(liveKeys.chat(sessionId), ENDED_SESSION_KEY_TTL_SECONDS)
    .expire(liveKeys.viewers(sessionId), ENDED_SESSION_KEY_TTL_SECONDS)
    .expire(liveKeys.peak(sessionId), ENDED_SESSION_KEY_TTL_SECONDS)
    .expire(liveKeys.muted(sessionId), ENDED_SESSION_KEY_TTL_SECONDS)
    .exec();
}
