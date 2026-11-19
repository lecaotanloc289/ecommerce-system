import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export type RotateResult = 'rotated' | 'grace' | 'reused' | 'missing';

/**
 * How long the token that was just rotated away may still be presented without counting as reuse.
 * Covers benign races: two tabs / SSR + client / StrictMode refreshing with the same cookie.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * Atomic compare-and-swap of the family's current token hash.
 *   1 → presented == current: rotate to the new hash (remember the old one as `prev`), refresh TTL
 *   2 → presented == prev, rotated ≤ grace ago: benign concurrent retry — nothing changes
 *  -1 → anything else in a live family (replay of an old token): delete the family (reuse detection)
 *   0 → family unknown (expired, logged out, or already revoked)
 * ARGV: presented, next, ttlSeconds, nowMs, graceMs
 */
const ROTATE_LUA = `
local current = redis.call('HGET', KEYS[1], 'current')
if not current then return 0 end
if current == ARGV[1] then
  redis.call('HSET', KEYS[1], 'current', ARGV[2], 'prev', ARGV[1], 'rotatedAt', ARGV[4])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return 1
end
local prev = redis.call('HGET', KEYS[1], 'prev')
local rotatedAt = tonumber(redis.call('HGET', KEYS[1], 'rotatedAt'))
if prev == ARGV[1] and rotatedAt and (tonumber(ARGV[4]) - rotatedAt) <= tonumber(ARGV[5]) then
  return 2
end
redis.call('DEL', KEYS[1])
return -1
`;

/**
 * Refresh-token state in Redis (no DB table). One hash per token family (= one login session):
 *   auth:rt:family:<fid>  { userId, current, prev?, rotatedAt? }  EX <refresh ttl>
 * `current` / `prev` are sha256 hashes — raw tokens are never stored.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async createFamily(
    familyId: string,
    userId: string,
    tokenHash: string,
    ttlSeconds: number,
  ): Promise<void> {
    const key = familyKey(familyId);
    await this.redis
      .multi()
      .hset(key, { userId, current: tokenHash })
      .expire(key, ttlSeconds)
      .exec();
  }

  async rotate(
    familyId: string,
    presentedHash: string,
    nextHash: string,
    ttlSeconds: number,
    nowMs: number = Date.now(),
  ): Promise<RotateResult> {
    const result = await this.redis.eval(
      ROTATE_LUA,
      1,
      familyKey(familyId),
      presentedHash,
      nextHash,
      String(ttlSeconds),
      String(nowMs),
      String(REFRESH_REUSE_GRACE_MS),
    );
    if (result === 1) return 'rotated';
    if (result === 2) return 'grace';
    if (result === -1) return 'reused';
    return 'missing';
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.redis.del(familyKey(familyId));
  }
}

function familyKey(familyId: string): string {
  return `auth:rt:family:${familyId}`;
}
