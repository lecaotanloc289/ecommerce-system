import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DomainError, LiveSessionStatus, type ReactionKind } from '@repo/core';
import type Redis from 'ioredis';
import type { AuthUser } from '../../auth/auth.schemas';
import { REDIS } from '../../redis/redis.module';
import { LiveEventsPublisher } from '../live-events.publisher';
import { liveKeys } from '../live-redis-keys';
import { LIVE_REALTIME_OPTIONS, type LiveRealtimeOptions } from './live-realtime.options';
import {
  hitFixedWindow,
  LiveSessionStatusCache,
  LiveUserRateLimiter,
} from './live-realtime-guards';

const RATE_WINDOW_MS = 1_000;

interface PendingBurst {
  counts: Partial<Record<ReactionKind, number>>;
  timer: NodeJS.Timeout;
}

/**
 * Reactions (plan Task G): per-user cap across all sessions (before any DB read) → ≤
 * `reactionsPerSecond` per user per session (fixed 1 s window in Redis, shared by all
 * instances) → LIVE only (status cached 1 s, found and not-found) → aggregated per instance per
 * session and published as one `reaction.burst` per `reactionFlushMs` window. Nothing persisted.
 */
@Injectable()
export class LiveReactionsService implements OnModuleDestroy {
  private readonly pending = new Map<string, PendingBurst>();

  constructor(
    private readonly statuses: LiveSessionStatusCache,
    private readonly userLimiter: LiveUserRateLimiter,
    private readonly publisher: LiveEventsPublisher,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(LIVE_REALTIME_OPTIONS) private readonly options: LiveRealtimeOptions,
  ) {}

  async react(user: AuthUser, sessionId: string, kind: ReactionKind): Promise<void> {
    await this.userLimiter.assertAllowed(user.id);
    const used = await hitFixedWindow(
      this.redis,
      liveKeys.reactionRate(sessionId, user.id),
      RATE_WINDOW_MS,
    );
    if (used > this.options.reactionsPerSecond) {
      throw new DomainError('live.error.chat-rate-limited');
    }
    if ((await this.statuses.get(sessionId)) !== LiveSessionStatus.LIVE) {
      throw new DomainError('live.error.not-live');
    }
    this.add(sessionId, kind);
  }

  /** Publishes whatever is pending (the Redis client is still open during module destroy). */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((sessionId) => this.flush(sessionId)));
  }

  private add(sessionId: string, kind: ReactionKind): void {
    let burst = this.pending.get(sessionId);
    if (!burst) {
      const timer = setTimeout(() => void this.flush(sessionId), this.options.reactionFlushMs);
      timer.unref();
      burst = { counts: {}, timer };
      this.pending.set(sessionId, burst);
    }
    burst.counts[kind] = (burst.counts[kind] ?? 0) + 1;
  }

  private async flush(sessionId: string): Promise<void> {
    const burst = this.pending.get(sessionId);
    if (!burst) return;
    this.pending.delete(sessionId);
    clearTimeout(burst.timer);
    await this.publisher.publish({ type: 'reaction.burst', sessionId, counts: burst.counts });
  }
}
