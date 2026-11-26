import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { ulid } from 'ulid';
import { z } from 'zod';
import { REDIS } from '../../redis/redis.module';
import { LiveEventsPublisher } from '../live-events.publisher';
import { LIVE_REALTIME_KEY_TTL_MS, liveKeys } from '../live-redis-keys';
import {
  LIVE_REALTIME_OPTIONS,
  type LiveRealtimeOptions,
  viewerTickLockMs,
} from './live-realtime.options';

/**
 * Scores come from the Redis server clock (`TIME`), never the instance clock, so instances with
 * skewed clocks agree on what is stale.
 */
const NOW_MS_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

/**
 * KEYS: viewers ZSET. ARGV: connection id, keyTtlMs. Adds or refreshes the connection's score.
 * Every write also refreshes the key's 24 h TTL: a write racing the session end (after its
 * `EXPIRE`) must not leave a key that never expires.
 */
const TOUCH_LUA = `${NOW_MS_LUA}
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

/**
 * KEYS: viewers ZSET, peak, tick lock. ARGV: staleMs, lockMs, keyTtlMs.
 * Prunes stale connections, counts, raises `peak` (Lua max), refreshes both keys' 24 h TTL
 * (see TOUCH_LUA), then tries the per-tick lock. Returns {count, wonLock 0|1}.
 */
const TICK_LUA = `${NOW_MS_LUA}
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', '(' .. (now - tonumber(ARGV[1])))
local count = redis.call('ZCARD', KEYS[1])
local peak = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
if count > peak then redis.call('SET', KEYS[2], count) end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[3])
if redis.call('SET', KEYS[3], '1', 'NX', 'PX', ARGV[2]) then return {count, 1} end
return {count, 0}
`;

const TickResultSchema = z.tuple([
  z.number().int().nonnegative(),
  z.union([z.literal(0), z.literal(1)]),
]);

interface LocalSession {
  connections: number;
  timer: NodeJS.Timeout;
}

/**
 * Viewer presence (plan Task G). Each SSE connection is a member of `live:{id}:viewers` (score =
 * last seen ms), refreshed on every ping and removed on close. Per instance, per session with ≥1
 * local connection, a ticker prunes entries older than `viewerStaleMs`, counts, raises
 * `live:{id}:peak`, and — only on the instance that wins `live:{id}:viewers-tick` (`SET NX PX`)
 * — publishes `viewers.updated`. Crashed instances' connections age out via the prune.
 */
@Injectable()
export class LiveViewersService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveViewersService.name);
  private readonly sessions = new Map<string, LocalSession>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly publisher: LiveEventsPublisher,
    @Inject(LIVE_REALTIME_OPTIONS) private readonly options: LiveRealtimeOptions,
  ) {}

  /**
   * Registers a connection; returns its id. Starts the session ticker on the first one. If the
   * Redis write fails the local registration is undone (no orphan ticker) and the error rethrown.
   */
  async connect(sessionId: string): Promise<string> {
    const connectionId = ulid();
    const local = this.sessions.get(sessionId);
    if (local) {
      local.connections += 1;
    } else {
      const timer = setInterval(() => void this.tick(sessionId), this.options.viewerTickMs);
      timer.unref();
      this.sessions.set(sessionId, { connections: 1, timer });
    }
    try {
      await this.touch(sessionId, connectionId);
    } catch (error) {
      this.releaseLocal(sessionId);
      throw error;
    }
    return connectionId;
  }

  /** Refreshes the connection's last-seen score (called on every SSE ping). */
  async touch(sessionId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      TOUCH_LUA,
      1,
      liveKeys.viewers(sessionId),
      connectionId,
      LIVE_REALTIME_KEY_TTL_MS,
    );
  }

  /** Removes the connection; stops the session ticker when it was the last local one. */
  async disconnect(sessionId: string, connectionId: string): Promise<void> {
    this.releaseLocal(sessionId);
    await this.redis.zrem(liveKeys.viewers(sessionId), connectionId);
  }

  /** One ticker round for a session. Public for tests; never throws. */
  async tick(sessionId: string): Promise<void> {
    try {
      const raw = await this.redis.eval(
        TICK_LUA,
        3,
        liveKeys.viewers(sessionId),
        liveKeys.peak(sessionId),
        liveKeys.viewersTick(sessionId),
        this.options.viewerStaleMs,
        viewerTickLockMs(this.options),
        LIVE_REALTIME_KEY_TTL_MS,
      );
      const [count, wonLock] = TickResultSchema.parse(raw);
      if (wonLock === 1) {
        await this.publisher.publish({ type: 'viewers.updated', sessionId, count });
      }
    } catch (error) {
      this.logger.warn({ err: error, sessionId }, 'live viewer tick failed');
    }
  }

  /** Sessions with a running local ticker (diagnostics / tests). */
  localSessionCount(): number {
    return this.sessions.size;
  }

  private releaseLocal(sessionId: string): void {
    const local = this.sessions.get(sessionId);
    if (!local) return;
    local.connections -= 1;
    if (local.connections <= 0) {
      clearInterval(local.timer);
      this.sessions.delete(sessionId);
    }
  }

  onModuleDestroy(): void {
    for (const local of this.sessions.values()) clearInterval(local.timer);
    this.sessions.clear();
  }
}
