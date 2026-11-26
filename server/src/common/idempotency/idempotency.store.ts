import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { z } from 'zod';
import { REDIS } from '../../redis/redis.module';

/** How long a completed response is replayable (D9). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** In-flight lock lifetime: a crashed request frees its key after this. Keep above handler latency. */
export const IDEMPOTENCY_LOCK_TTL_MS = 60 * 1000;

const RecordSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('processing'), fingerprint: z.string(), lockId: z.string() }),
  z.object({
    state: z.literal('completed'),
    fingerprint: z.string(),
    status: z.number().int(),
    body: z.unknown(),
  }),
]);

function parseRecord(raw: string): z.infer<typeof RecordSchema> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = RecordSchema.safeParse(parsed);
    return record.success ? record.data : null;
  } catch {
    return null;
  }
}

export type AcquireResult =
  /** Caller owns the key: run the handler, then `complete` or `release` with this lock. */
  | { outcome: 'acquired'; lock: string }
  | { outcome: 'in-progress' }
  | { outcome: 'key-reused' }
  | { outcome: 'replay'; status: number; body: unknown };

// Compare-and-swap / compare-and-delete: only the request holding the lock may finish it.
const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
end
return false`;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * Redis state behind `@Idempotent()`. One key per (user, Idempotency-Key):
 * `{ state: 'processing', fingerprint, lockId }` (SET NX PX, short TTL) while the handler runs,
 * then `{ state: 'completed', fingerprint, status, body }` for IDEMPOTENCY_TTL_MS.
 */
@Injectable()
export class IdempotencyStore {
  private readonly logger = new Logger(IdempotencyStore.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async acquire(key: string, fingerprint: string): Promise<AcquireResult> {
    const lock = JSON.stringify({ state: 'processing', fingerprint, lockId: randomUUID() });
    // Two rounds cover a record that expires between the failed SET NX and the GET.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const set = await this.redis.set(key, lock, 'PX', IDEMPOTENCY_LOCK_TTL_MS, 'NX');
      if (set === 'OK') return { outcome: 'acquired', lock };

      const raw = await this.redis.get(key);
      if (raw === null) continue;
      const record = parseRecord(raw);
      if (!record) {
        // Corrupt / foreign-format record: never re-execute — the request may have completed.
        this.logger.error({ key }, 'unreadable idempotency record');
        return { outcome: 'key-reused' };
      }
      if (record.fingerprint !== fingerprint) return { outcome: 'key-reused' };
      if (record.state === 'processing') return { outcome: 'in-progress' };
      return { outcome: 'replay', status: record.status, body: record.body };
    }
    return { outcome: 'in-progress' };
  }

  /**
   * Stores the successful response under the key if `lock` still holds it. Returns false when the
   * lock was lost (handler outlived IDEMPOTENCY_LOCK_TTL_MS): a retry may have run concurrently.
   */
  async complete(
    key: string,
    lock: string,
    fingerprint: string,
    status: number,
    body: unknown,
  ): Promise<boolean> {
    const record = JSON.stringify({ state: 'completed', fingerprint, status, body });
    const result = await this.redis.eval(COMPLETE_SCRIPT, 1, key, lock, record, IDEMPOTENCY_TTL_MS);
    return result === 'OK';
  }

  /** Frees the key (handler failed) so the client can retry with the same key. */
  async release(key: string, lock: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, lock);
  }
}
