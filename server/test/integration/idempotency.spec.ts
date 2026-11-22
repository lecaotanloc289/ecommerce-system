import { Body, Controller, Injectable, Module, Param, Post, UseGuards } from '@nestjs/common';
import { DomainError } from '@repo/core';
import type { InjectOptions } from 'fastify';
import { ulid } from 'ulid';
import { AuthModule } from '../../src/auth/auth.module';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
} from '../../src/common/idempotency/idempotency.interceptor';
import { Idempotent } from '../../src/common/idempotency/idempotent.decorator';
import { type TestApp, createTestApp, makeUser } from '../support';

/** Shared state between the spec and the test controller. */
@Injectable()
class Probe {
  calls = 0;
  failNext = false;
  hold: Promise<void> | null = null;
}

@Controller('test-idem')
class IdemTestController {
  constructor(private readonly probe: Probe) {}

  @Post(':id')
  @UseGuards(JwtAuthGuard)
  @Idempotent()
  async create(@Param('id') id: string, @Body() body: unknown) {
    this.probe.calls += 1;
    const call = this.probe.calls;
    if (this.probe.failNext) {
      this.probe.failNext = false;
      throw new DomainError('common.error.conflict');
    }
    if (this.probe.hold) await this.probe.hold;
    return { call, id, body };
  }

  /** No JwtAuthGuard: the interceptor itself must refuse (keys are user-scoped). */
  @Post('unguarded/x')
  @Idempotent()
  unguarded() {
    return { ok: true };
  }
}

@Module({ imports: [AuthModule], controllers: [IdemTestController], providers: [Probe] })
class IdemTestModule {}

describe('@Idempotent() (real Redis)', () => {
  let t: TestApp;
  let probe: Probe;
  let headers: Record<string, string>;
  let otherHeaders: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp({ imports: [IdemTestModule] });
    probe = t.app.get(Probe);
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    probe.calls = 0;
    probe.failNext = false;
    probe.hold = null;
    headers = await t.authHeader(await makeUser(t.db));
    otherHeaders = await t.authHeader(await makeUser(t.db));
  });

  const post = (
    key: string | undefined,
    payload: object,
    auth: Record<string, string> = headers,
    url = '/v1/test-idem/a',
  ) => {
    const options: InjectOptions = {
      method: 'POST',
      url,
      headers: { ...auth, ...(key !== undefined && { [IDEMPOTENCY_KEY_HEADER]: key }) },
      payload,
    };
    return t.app.inject(options);
  };

  it('runs the handler once and replays the stored response', async () => {
    const key = ulid();
    const first = await post(key, { qty: 1, sku: 'A' });
    expect(first.statusCode).toBe(201);
    expect(first.headers[IDEMPOTENT_REPLAYED_HEADER]).toBeUndefined();

    // Same body with a different key order is the same request.
    const replay = await post(key, { sku: 'A', qty: 1 });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers[IDEMPOTENT_REPLAYED_HEADER]).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(probe.calls).toBe(1);
  });

  it('rejects a key reused with a different body (422) or URL (422)', async () => {
    const key = ulid();
    expect((await post(key, { qty: 1 })).statusCode).toBe(201);

    const otherBody = await post(key, { qty: 2 });
    expect(otherBody.statusCode).toBe(422);
    expect(otherBody.json()).toEqual({ errorCode: 'idempotency.error.key-reused', params: {} });

    const otherUrl = await post(key, { qty: 1 }, headers, '/v1/test-idem/b');
    expect(otherUrl.statusCode).toBe(422);
    expect(probe.calls).toBe(1);
  });

  it('answers 409 while the first request is still running', async () => {
    let release = (): void => undefined;
    probe.hold = new Promise((resolve) => {
      release = resolve;
    });
    const key = ulid();
    const first = post(key, { qty: 1 }).then((res) => res);
    while (probe.calls === 0) await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await post(key, { qty: 1 });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ errorCode: 'idempotency.error.in-progress', params: {} });

    release();
    expect((await first).statusCode).toBe(201);
    expect((await post(key, { qty: 1 })).headers[IDEMPOTENT_REPLAYED_HEADER]).toBe('true');
    expect(probe.calls).toBe(1);
  });

  it.each([
    ['missing', undefined],
    ['not a ULID', 'not-a-ulid'],
    ['lowercase ULID', ulid().toLowerCase()],
  ])('requires a valid Idempotency-Key header (%s → 400)', async (_label, key) => {
    const res = await post(key, { qty: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ errorCode: 'idempotency.error.key-required', params: {} });
    expect(probe.calls).toBe(0);
  });

  it('releases the key when the handler fails, so the client can retry it', async () => {
    probe.failNext = true;
    const key = ulid();
    const failed = await post(key, { qty: 1 });
    expect(failed.statusCode).toBe(409);
    expect(failed.json()).toEqual({ errorCode: 'common.error.conflict', params: {} });

    const retried = await post(key, { qty: 1 });
    expect(retried.statusCode).toBe(201);
    expect(retried.headers[IDEMPOTENT_REPLAYED_HEADER]).toBeUndefined();
    expect(probe.calls).toBe(2);
  });

  it('scopes keys per user', async () => {
    const key = ulid();
    expect((await post(key, { qty: 1 })).statusCode).toBe(201);
    const other = await post(key, { qty: 1 }, otherHeaders);
    expect(other.statusCode).toBe(201);
    expect(other.headers[IDEMPOTENT_REPLAYED_HEADER]).toBeUndefined();
    expect(probe.calls).toBe(2);
  });

  it('fails closed on a route without an authenticated user', async () => {
    const res = await post(ulid(), {}, {}, '/v1/test-idem/unguarded/x');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ errorCode: 'common.error.unauthorized', params: {} });
  });

  it('does not overwrite the key when the lock expired mid-request', async () => {
    let release = (): void => undefined;
    probe.hold = new Promise((resolve) => {
      release = resolve;
    });
    const key = ulid();
    const first = post(key, { qty: 1 }).then((res) => res);
    while (probe.calls === 0) await new Promise((resolve) => setTimeout(resolve, 5));

    // Simulate the 60s lock expiring and a retry taking the key.
    const [redisKey = ''] = await t.redis.keys('idem:*');
    await t.redis.set(redisKey, 'taken-by-retry');
    release();
    expect((await first).statusCode).toBe(201);
    await expect(t.redis.get(redisKey)).resolves.toBe('taken-by-retry');
  });

  it('treats an unreadable record as a reused key (never re-executes)', async () => {
    const key = ulid();
    await post(key, { qty: 1 });
    const [redisKey = ''] = await t.redis.keys('idem:*');
    await t.redis.set(redisKey, '{"state":"from-the-future"}');

    const res = await post(key, { qty: 1 });
    expect(res.statusCode).toBe(422);
    expect(probe.calls).toBe(1);
  });

  it('stores the completed response in Redis for 24h', async () => {
    const key = ulid();
    await post(key, { qty: 1 });
    const [redisKey] = await t.redis.keys('idem:*');
    expect(redisKey).toMatch(new RegExp(`^idem:[0-9A-Z]{26}:${key}$`));
    const ttl = await t.redis.pttl(redisKey ?? '');
    expect(ttl).toBeGreaterThan(23 * 3600 * 1000);
  });
});
