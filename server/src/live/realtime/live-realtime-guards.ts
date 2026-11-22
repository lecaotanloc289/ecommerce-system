import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type LiveSessionStatus } from '@repo/core';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.module';
import { liveKeys } from '../live-redis-keys';
import { LiveSessionService } from '../live-session.service';
import { LIVE_REALTIME_OPTIONS, type LiveRealtimeOptions } from './live-realtime.options';

const STATUS_CACHE_MS = 1_000;
const STATUS_CACHE_MAX_ENTRIES = 1_000;

/**
 * `SET key 0 NX PX window` + `INCR` in one MULTI: a fixed window shared by every instance.
 * Returns the number of hits in the current window (including this one).
 */
export async function hitFixedWindow(redis: Redis, key: string, windowMs: number): Promise<number> {
  const result = await redis.multi().set(key, '0', 'PX', windowMs, 'NX').incr(key).exec();
  const used = result?.[1]?.[1];
  if (typeof used !== 'number') throw new Error(`rate counter ${key} failed`);
  return used;
}

/**
 * Per-user cap on chat + reaction POSTs across ALL sessions (`live:user-rate:{userId}`, 1 s).
 * Runs before any DB read, so rotating random session ids cannot multiply lookups.
 */
@Injectable()
export class LiveUserRateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(LIVE_REALTIME_OPTIONS) private readonly options: LiveRealtimeOptions,
  ) {}

  async assertAllowed(userId: string): Promise<void> {
    const used = await hitFixedWindow(this.redis, liveKeys.userRate(userId), 1_000);
    if (used > this.options.userActionsPerSecond)
      throw new DomainError('common.error.rate-limited');
  }
}

type CachedStatus = { status: LiveSessionStatus | null; expiresAt: number };

/**
 * Public session status for the realtime hot paths (chat, reactions, chat history), cached
 * per instance for 1 s — found AND not-found, so unknown ids can't hammer Postgres. A status
 * change (e.g. the end) is therefore seen up to 1 s late on these paths. The SSE stream and all
 * state transitions read the DB directly.
 */
@Injectable()
export class LiveSessionStatusCache {
  private readonly entries = new Map<string, CachedStatus>();

  constructor(private readonly sessions: LiveSessionService) {}

  /** Throws `live.error.not-found` like `LiveSessionService.getPublicStatus`. */
  async get(sessionId: string): Promise<LiveSessionStatus> {
    const now = Date.now();
    const cached = this.entries.get(sessionId);
    const status =
      cached && cached.expiresAt > now ? cached.status : await this.load(sessionId, now);
    if (status === null) throw new DomainError('live.error.not-found');
    return status;
  }

  private async load(sessionId: string, now: number): Promise<LiveSessionStatus | null> {
    let status: LiveSessionStatus | null;
    try {
      status = await this.sessions.getPublicStatus(sessionId);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'live.error.not-found') throw error;
      status = null;
    }
    if (this.entries.size >= STATUS_CACHE_MAX_ENTRIES) {
      for (const [id, entry] of this.entries) {
        if (entry.expiresAt <= now) this.entries.delete(id);
      }
      if (this.entries.size >= STATUS_CACHE_MAX_ENTRIES) this.entries.clear();
    }
    this.entries.set(sessionId, { status, expiresAt: now + STATUS_CACHE_MS });
    return status;
  }
}
