/**
 * Redis keys and channels shared by the server and `workers/outbox` (plan §1.5). Keep in sync
 * with the worker — the names are a cross-process contract.
 */
export const liveKeys = {
  /** pub/sub channel — JSON `LiveEvent`, validated before publish. */
  events: (sessionId: string) => `live:${sessionId}:events`,
  /** Stream — chat messages (`XADD MAXLEN ~ 200`). */
  chat: (sessionId: string) => `live:${sessionId}:chat`,
  /** ZSET — member = SSE connection id, score = last-seen ms. */
  viewers: (sessionId: string) => `live:${sessionId}:viewers`,
  /** string int — max concurrent viewers seen. */
  peak: (sessionId: string) => `live:${sessionId}:peak`,
  /** SET — muted userIds. */
  muted: (sessionId: string) => `live:${sessionId}:muted`,
  /** string (10 min) — chat POST dedupe → stored message id. */
  chatDedupe: (sessionId: string, clientMessageId: string) =>
    `live:${sessionId}:chat-dedupe:${clientMessageId}`,
  /** string (PX) — per-user chat cooldown (`SET NX PX`). */
  cooldown: (sessionId: string, userId: string) => `live:${sessionId}:cooldown:${userId}`,
  // Server-only keys (not shared with the worker).
  /** string (PX) — lock: only the instance that sets it publishes `viewers.updated` this tick. */
  viewersTick: (sessionId: string) => `live:${sessionId}:viewers-tick`,
  /** string int (PX 1 s window) — per-user reaction rate counter. */
  reactionRate: (sessionId: string, userId: string) => `live:${sessionId}:reaction-rate:${userId}`,
  /** string int (PX 1 s window) — per-user cap on chat + reaction POSTs across all sessions. */
  userRate: (userId: string) => `live:user-rate:${userId}`,
  /** string (24 h) — webhook replay guard, keyed by sha256(raw body). */
  webhookDedupe: (sha256: string) => `live:webhook-dedupe:${sha256}`,
} as const;

/** After a session ends, its realtime keys are kept this long (chat replay, final counts). */
export const LIVE_ENDED_KEY_TTL_SECONDS = 86_400;

/**
 * Realtime writes (chat XADD, viewer ZADD/peak, mute SADD) also (re)set this TTL, so a write that
 * races the end — after its EXPIRE ran — can never leave a key without expiry. While a session
 * runs the TTL keeps sliding forward on every write.
 */
export const LIVE_REALTIME_KEY_TTL_MS = LIVE_ENDED_KEY_TTL_SECONDS * 1000;

/** Webhook deliveries are deduplicated for this long (after a successful apply). */
export const LIVE_WEBHOOK_DEDUPE_TTL_SECONDS = 86_400;

/** In-flight claim of a webhook delivery; extended to the dedupe window once applied. */
export const LIVE_WEBHOOK_CLAIM_TTL_SECONDS = 60;

/** Keys that get `EXPIRE LIVE_ENDED_KEY_TTL_SECONDS` when a session ends. */
export function liveKeysExpiringOnEnd(sessionId: string): string[] {
  return [
    liveKeys.chat(sessionId),
    liveKeys.viewers(sessionId),
    liveKeys.peak(sessionId),
    liveKeys.muted(sessionId),
  ];
}
