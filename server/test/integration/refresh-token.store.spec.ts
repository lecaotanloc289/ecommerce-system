import Redis from 'ioredis';
import { REFRESH_REUSE_GRACE_MS, RefreshTokenStore } from '../../src/auth/refresh-token.store';

/** Real Redis (harness container, this worker's DB) — exercises the atomic Lua rotation script. */
describe('RefreshTokenStore (Redis)', () => {
  let redis: Redis;
  let store: RefreshTokenStore;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? '');
    store = new RefreshTokenStore(redis);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  beforeEach(() => redis.flushdb());

  it('creates a family with hash + userId and a TTL', async () => {
    await store.createFamily('fam1', 'user1', 'hash-a', 3600);
    await expect(redis.hgetall('auth:rt:family:fam1')).resolves.toEqual({
      userId: 'user1',
      current: 'hash-a',
    });
    const ttl = await redis.ttl('auth:rt:family:fam1');
    expect(ttl).toBeGreaterThan(3590);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('rotates when the presented hash is current, refreshing the TTL', async () => {
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    await expect(store.rotate('fam1', 'hash-a', 'hash-b', 7200)).resolves.toBe('rotated');
    await expect(redis.hget('auth:rt:family:fam1', 'current')).resolves.toBe('hash-b');
    await expect(redis.ttl('auth:rt:family:fam1')).resolves.toBeGreaterThan(7000);
  });

  it('detects reuse of a stale hash after the grace window and deletes the family', async () => {
    const t0 = Date.now();
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    await store.rotate('fam1', 'hash-a', 'hash-b', 60, t0);

    const late = t0 + REFRESH_REUSE_GRACE_MS + 1;
    await expect(store.rotate('fam1', 'hash-a', 'hash-c', 60, late)).resolves.toBe('reused');
    await expect(redis.exists('auth:rt:family:fam1')).resolves.toBe(0);
    await expect(store.rotate('fam1', 'hash-b', 'hash-d', 60, late)).resolves.toBe('missing');
  });

  it('treats a retry of the just-rotated hash within the grace window as benign', async () => {
    const t0 = Date.now();
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    await store.rotate('fam1', 'hash-a', 'hash-b', 60, t0);

    await expect(
      store.rotate('fam1', 'hash-a', 'hash-x', 60, t0 + REFRESH_REUSE_GRACE_MS),
    ).resolves.toBe('grace');
    // Nothing changed: hash-b is still current and rotates normally.
    await expect(redis.hget('auth:rt:family:fam1', 'current')).resolves.toBe('hash-b');
    await expect(store.rotate('fam1', 'hash-b', 'hash-c', 60, t0 + 1)).resolves.toBe('rotated');
  });

  it('a hash two rotations old is reuse even inside the grace window', async () => {
    const t0 = Date.now();
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    await store.rotate('fam1', 'hash-a', 'hash-b', 60, t0);
    await store.rotate('fam1', 'hash-b', 'hash-c', 60, t0);
    await expect(store.rotate('fam1', 'hash-a', 'hash-x', 60, t0)).resolves.toBe('reused');
  });

  it('two concurrent refreshes with the same token: one rotates, the other is a grace retry', async () => {
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    const results = await Promise.all([
      store.rotate('fam1', 'hash-a', 'hash-b', 60),
      store.rotate('fam1', 'hash-a', 'hash-c', 60),
    ]);
    expect(results.sort()).toEqual(['grace', 'rotated']);
    await expect(redis.exists('auth:rt:family:fam1')).resolves.toBe(1);
  });

  it('reports unknown families as missing and revokes idempotently', async () => {
    await expect(store.rotate('nope', 'h', 'h2', 60)).resolves.toBe('missing');
    await store.createFamily('fam1', 'user1', 'hash-a', 60);
    await store.revokeFamily('fam1');
    await store.revokeFamily('fam1');
    await expect(store.rotate('fam1', 'hash-a', 'hash-b', 60)).resolves.toBe('missing');
  });
});
