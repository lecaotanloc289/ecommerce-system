import { Redis } from 'ioredis';

/**
 * Redis connection for BullMQ (roadmap D10). The outbox dispatcher does not need it — it is
 * opened and pinged at boot so a bad `REDIS_URL` fails fast, and T3.2's repeatable jobs reuse it
 * (`new Queue(name, { connection })`). BullMQ requires `maxRetriesPerRequest: null`.
 */
export async function connectRedis(url: string): Promise<Redis> {
  const redis = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: true });
  await redis.connect();
  await redis.ping();
  return redis;
}
