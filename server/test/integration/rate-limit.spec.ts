import type { InjectOptions } from 'fastify';
import { type TestApp, createTestApp } from '../support';

/** @fastify/rate-limit on the real app + Redis store, with tiny limits (one trusted proxy hop). */
describe('rate limit', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({
      env: {
        RATE_LIMIT_MAX: '3',
        RATE_LIMIT_STRICT_MAX: '2',
        RATE_LIMIT_WINDOW: '1m',
        TRUSTED_PROXY_HOPS: '1',
      },
    });
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const PROXY = '10.255.0.1';
  /** A request as the edge proxy forwards it: socket peer = proxy, last XFF entry = client. */
  const via = (
    client: string,
    spoofed?: string,
  ): Pick<InjectOptions, 'remoteAddress' | 'headers'> => ({
    remoteAddress: PROXY,
    headers: { 'x-forwarded-for': spoofed ? `${spoofed}, ${client}` : client },
  });
  // Any non-exempt route counts against the default bucket; unauthenticated /me answers 401.
  const me = (client: string, spoofed?: string) =>
    t.app.inject({ method: 'GET', url: '/v1/auth/me', ...via(client, spoofed) });
  const logout = (client: string) =>
    t.app.inject({ method: 'POST', url: '/v1/auth/logout', ...via(client) });

  it('allows RATE_LIMIT_MAX requests per client, then answers 429 common.error.rate-limited', async () => {
    for (let i = 0; i < 3; i += 1) expect((await me('203.0.113.1')).statusCode).toBe(401);

    const limited = await me('203.0.113.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ errorCode: 'common.error.rate-limited', params: {} });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // Another client behind the same proxy is unaffected.
    expect((await me('203.0.113.2')).statusCode).toBe(401);
  });

  it('ignores client-supplied X-Forwarded-For entries beyond the trusted hops', async () => {
    for (let i = 0; i < 3; i += 1) await me('203.0.113.3', `198.51.100.${i}`);
    expect((await me('203.0.113.3', '198.51.100.99')).statusCode).toBe(429);
  });

  it('@RateLimit("strict") routes have their own, smaller bucket', async () => {
    expect((await logout('203.0.113.4')).statusCode).toBe(204);
    expect((await logout('203.0.113.4')).statusCode).toBe(204);
    const limited = await logout('203.0.113.4');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ errorCode: 'common.error.rate-limited', params: {} });

    // The default bucket of the same client is untouched.
    expect((await me('203.0.113.4')).statusCode).toBe(401);
  });

  it('never limits health probes', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await t.app.inject({ method: 'GET', url: '/v1/health', ...via('203.0.113.5') });
      expect(res.statusCode).toBe(200);
    }
  });

  it('counts in Redis (shared across instances): default fails open, strict fails closed', async () => {
    await me('203.0.113.6');
    await expect(t.redis.keys('rl:*')).resolves.not.toHaveLength(0);

    // The limiter's Lua script runs via EVALSHA/EVAL through sendCommand: simulate an outage there.
    const send = t.redis.sendCommand.bind(t.redis);
    const outage = jest.spyOn(t.redis, 'sendCommand').mockImplementation((command, stream) => {
      if (command.name !== 'evalsha' && command.name !== 'eval') return send(command, stream);
      // Script callbacks hang off the command's own promise — fail that one.
      command.reject(new Error('redis down'));
      return command.promise;
    });
    try {
      expect((await me('203.0.113.6')).statusCode).toBe(401);
      expect((await logout('203.0.113.6')).statusCode).toBe(500);
    } finally {
      outage.mockRestore();
    }
  });
});
