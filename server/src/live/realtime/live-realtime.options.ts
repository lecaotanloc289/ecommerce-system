/**
 * Realtime timing knobs (plan Task G). Protocol constants, not business tunables (those live in
 * `PlatformSettings`, e.g. `liveChatCooldownSeconds`). Overridable only so tests can run fast.
 */
export interface LiveRealtimeOptions {
  /** SSE `: ping` comment + viewer ZSET score refresh. */
  pingIntervalMs: number;
  /** Viewer ticker period (prune + count + peak + publish). */
  viewerTickMs: number;
  /** Viewer entries not refreshed for this long are pruned. */
  viewerStaleMs: number;
  /** Reactions are aggregated per instance per session and published once per window. */
  reactionFlushMs: number;
  /** Max reactions per user per session per second. */
  reactionsPerSecond: number;
  /** Max chat + reaction POSTs per user per second across all sessions (checked before any DB read). */
  userActionsPerSecond: number;
  /** Per-instance cap on concurrent SSE streams from one client IP. */
  maxSseConnectionsPerIp: number;
  /** Per-instance cap on concurrent SSE streams in total. */
  maxSseConnections: number;
  /** Every Nth ping, an open stream re-reads the session status and closes if it is over. */
  sseStatusRecheckEveryPings: number;
}

export const LIVE_REALTIME_OPTIONS = Symbol('LIVE_REALTIME_OPTIONS');

export const DEFAULT_LIVE_REALTIME_OPTIONS: LiveRealtimeOptions = {
  pingIntervalMs: 15_000,
  viewerTickMs: 5_000,
  viewerStaleMs: 30_000,
  reactionFlushMs: 1_000,
  reactionsPerSecond: 10,
  userActionsPerSecond: 20,
  maxSseConnectionsPerIp: 20,
  maxSseConnections: 10_000,
  sseStatusRecheckEveryPings: 4,
};

/** Only the lock winner publishes `viewers.updated`; the lock expires just before the next tick. */
export function viewerTickLockMs(options: LiveRealtimeOptions): number {
  return Math.max(1, Math.floor(options.viewerTickMs * 0.9));
}
