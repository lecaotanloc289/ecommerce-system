import { Role } from '@repo/core';
import { ulid } from 'ulid';
import {
  addVendorStaff,
  createProduct,
  createUser,
  createVendor,
  resetDatabase,
  resetRedis,
} from '../integration/pg';
import { createLiveTestApp, type LiveTestApp, provision } from './live-test-app';

/**
 * HTTP (Fastify inject) over the real LiveModule, guards, pipes, filter, Postgres and Redis.
 * Tokens are real access JWTs built from the DB roles.
 */
describe('Live sessions HTTP', () => {
  let ctx: LiveTestApp;
  let vendorId: string;
  let ownerId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await createLiveTestApp({ devRoutes: true });
  });

  afterAll(() => ctx?.app.close());

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    await resetRedis(ctx.redis);
    ({ vendorId, ownerId } = await createVendor(ctx.db));
    productId = await createProduct(ctx.db, vendorId);
  });

  async function createSession(key = ulid()) {
    return ctx.app.inject({
      method: 'POST',
      url: '/v1/vendor/live-sessions',
      headers: { ...(await ctx.authHeader(ownerId)), 'idempotency-key': key },
      payload: { title: '  Flash sale  ', productIds: [productId] },
    });
  }

  it('POST /vendor/live-sessions: 201, then 200 on replay; key required; body validated', async () => {
    const key = ulid();
    const created = await createSession(key);
    expect(created.statusCode).toBe(201);
    const body = created.json<{ id: string; status: string; vendorId: string }>();
    expect(body).toMatchObject({
      status: 'SCHEDULED',
      vendorId,
      title: 'Flash sale',
      scheduledAt: null,
    });

    const replay = await createSession(key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(created.json());

    const noKey = await ctx.app.inject({
      method: 'POST',
      url: '/v1/vendor/live-sessions',
      headers: await ctx.authHeader(ownerId),
      payload: { title: 'Flash sale', productIds: [] },
    });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json()).toEqual({ errorCode: 'idempotency.error.key-required', params: {} });

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/v1/vendor/live-sessions',
      headers: { ...(await ctx.authHeader(ownerId)), 'idempotency-key': ulid() },
      payload: { title: 'x', productIds: [productId, productId], vendorId: ulid() },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toEqual({ errorCode: 'common.error.validation-failed', params: {} });
  });

  it('role matrix', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const customerId = await createUser(ctx.db);
    const staffId = await createUser(ctx.db, [{ role: Role.PLATFORM_STAFF }]);
    const vendorStaffId = await addVendorStaff(ctx.db, vendorId);

    const guest = await ctx.app.inject({ method: 'GET', url: '/v1/vendor/live-sessions' });
    expect(guest.statusCode).toBe(401);

    const customer = await ctx.app.inject({
      method: 'GET',
      url: '/v1/vendor/live-sessions',
      headers: await ctx.authHeader(customerId),
    });
    expect(customer.statusCode).toBe(403);

    for (const userId of [ownerId, vendorStaffId]) {
      const list = await ctx.app.inject({
        method: 'GET',
        url: '/v1/vendor/live-sessions?status=SCHEDULED',
        headers: await ctx.authHeader(userId),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json<{ id: string }[]>().map((s) => s.id)).toEqual([session.id]);
    }

    const platformList = await ctx.app.inject({
      method: 'GET',
      url: '/v1/platform/live-sessions',
      headers: await ctx.authHeader(staffId),
    });
    expect(platformList.statusCode).toBe(200);
    expect(platformList.json<{ id: string }[]>().map((s) => s.id)).toEqual([session.id]);

    const vendorOnPlatform = await ctx.app.inject({
      method: 'GET',
      url: '/v1/platform/live-sessions',
      headers: await ctx.authHeader(ownerId),
    });
    expect(vendorOnPlatform.statusCode).toBe(403);

    const staffOnVendor = await ctx.app.inject({
      method: 'GET',
      url: '/v1/vendor/live-sessions',
      headers: await ctx.authHeader(staffId),
    });
    expect(staffOnVendor.statusCode).toBe(403);
  });

  it('terminate: platform staff OK, vendor 403, guest 401', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const liveInputId = await provision(ctx, session.id);
    await ctx.service.applyEncoderEvent({ liveInputId, isConnected: true, occurredAt: new Date() });
    const goLive = await ctx.app.inject({
      method: 'POST',
      url: `/v1/vendor/live-sessions/${session.id}/go-live`,
      headers: await ctx.authHeader(ownerId),
    });
    expect(goLive.statusCode).toBe(200);
    expect(goLive.json()).toMatchObject({ status: 'LIVE' });

    const url = `/v1/platform/live-sessions/${session.id}/terminate`;
    const payload = { reason: 'Prohibited goods' };
    const guest = await ctx.app.inject({ method: 'POST', url, payload });
    expect(guest.statusCode).toBe(401);
    const vendor = await ctx.app.inject({
      method: 'POST',
      url,
      payload,
      headers: await ctx.authHeader(ownerId),
    });
    expect(vendor.statusCode).toBe(403);

    const staffId = await createUser(ctx.db, [{ role: Role.PLATFORM_STAFF }]);
    const staff = await ctx.app.inject({
      method: 'POST',
      url,
      payload,
      headers: await ctx.authHeader(staffId),
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json()).toMatchObject({
      status: 'ENDED',
      endReason: 'TERMINATED',
      endNote: 'Prohibited goods',
    });

    const shortReason = await ctx.app.inject({
      method: 'POST',
      url,
      payload: { reason: ' x ' },
      headers: await ctx.authHeader(staffId),
    });
    expect(shortReason.statusCode).toBe(422);
  });

  it('vendor B gets 404 on vendor A’s session; malformed ids are 404', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const b = await createVendor(ctx.db);
    const asB = await ctx.app.inject({
      method: 'GET',
      url: `/v1/vendor/live-sessions/${session.id}`,
      headers: await ctx.authHeader(b.ownerId),
    });
    expect(asB.statusCode).toBe(404);
    expect(asB.json()).toEqual({ errorCode: 'live.error.not-found', params: {} });

    const malformed = await ctx.app.inject({
      method: 'GET',
      url: '/v1/live-sessions/not-an-id',
    });
    expect(malformed.json()).toEqual({ errorCode: 'live.error.not-found', params: {} });
  });

  it('GET ingest-credentials returns the fake key with Cache-Control: no-store', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const url = `/v1/vendor/live-sessions/${session.id}/ingest-credentials`;

    const before = await ctx.app.inject({
      method: 'GET',
      url,
      headers: await ctx.authHeader(ownerId),
    });
    expect(before.statusCode).toBe(409);
    expect(before.json()).toEqual({ errorCode: 'live.error.not-provisioned', params: {} });

    const liveInputId = await provision(ctx, session.id);
    const res = await ctx.app.inject({
      method: 'GET',
      url,
      headers: await ctx.authHeader(ownerId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      rtmpsUrl: 'rtmps://live.fake.invalid:443/live/',
      streamKey: `fake-key-${liveInputId}`,
    });

    await ctx.stream.retireLiveInput(liveInputId);
    const down = await ctx.app.inject({
      method: 'GET',
      url,
      headers: await ctx.authHeader(ownerId),
    });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({
      errorCode: 'live.error.stream-provider-unavailable',
      params: {},
    });
  });

  it('line-up: PUT products, pin and unpin over HTTP', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const second = await createProduct(ctx.db, vendorId);
    const headers = await ctx.authHeader(ownerId);

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/vendor/live-sessions/${session.id}/products`,
      headers,
      payload: { productIds: [second, productId] },
    });
    expect(put.statusCode).toBe(200);
    expect(
      put.json<{ products: { productId: string }[] }>().products.map((p) => p.productId),
    ).toEqual([second, productId]);

    const pin = await ctx.app.inject({
      method: 'POST',
      url: `/v1/vendor/live-sessions/${session.id}/products/${productId}/pin`,
      headers,
    });
    expect(pin.statusCode).toBe(200);
    const unpin = await ctx.app.inject({
      method: 'POST',
      url: `/v1/vendor/live-sessions/${session.id}/products/${productId}/unpin`,
      headers,
    });
    expect(unpin.statusCode).toBe(200);
    expect(unpin.json<{ products: { pinnedAt: string | null }[] }>().products).toEqual([
      expect.objectContaining({ pinnedAt: null }),
      expect.objectContaining({ pinnedAt: null }),
    ]);
  });

  it('public endpoints: default LIVE listing, CANCELLED hidden, CANCELLED filter rejected', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const list = await ctx.app.inject({ method: 'GET', url: '/v1/live-sessions' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);

    const upcoming = await ctx.app.inject({
      method: 'GET',
      url: '/v1/live-sessions?status=SCHEDULED',
    });
    expect(upcoming.json<{ id: string }[]>().map((s) => s.id)).toEqual([session.id]);

    const detail = await ctx.app.inject({ method: 'GET', url: `/v1/live-sessions/${session.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: session.id, playback: null });
    expect(detail.json()).not.toHaveProperty('isProvisioned');

    await ctx.app.inject({
      method: 'POST',
      url: `/v1/vendor/live-sessions/${session.id}/cancel`,
      headers: await ctx.authHeader(ownerId),
    });
    const gone = await ctx.app.inject({ method: 'GET', url: `/v1/live-sessions/${session.id}` });
    expect(gone.statusCode).toBe(404);

    const cancelled = await ctx.app.inject({
      method: 'GET',
      url: '/v1/live-sessions?status=CANCELLED',
    });
    expect(cancelled.statusCode).toBe(422);
    const bogus = await ctx.app.inject({ method: 'GET', url: '/v1/live-sessions?status=NOPE' });
    expect(bogus.statusCode).toBe(422);
  });

  it('dev encoder simulation (fake provider) drives the same path as the webhook', async () => {
    const session = (await createSession()).json<{ id: string }>();
    const url = `/v1/dev/live-sessions/${session.id}/encoder`;
    const headers = await ctx.authHeader(ownerId);

    const unprovisioned = await ctx.app.inject({
      method: 'POST',
      url,
      headers,
      payload: { connected: true },
    });
    expect(unprovisioned.json()).toEqual({ errorCode: 'live.error.not-provisioned', params: {} });

    await provision(ctx, session.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url,
      headers,
      payload: { connected: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isEncoderConnected: true });

    const b = await createVendor(ctx.db);
    const foreign = await ctx.app.inject({
      method: 'POST',
      url,
      headers: await ctx.authHeader(b.ownerId),
      payload: { connected: false },
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('Live sessions HTTP without dev routes', () => {
  let ctx: LiveTestApp;

  beforeAll(async () => {
    ctx = await createLiveTestApp({ devRoutes: false });
  });

  afterAll(() => ctx?.app.close());

  it('does not register /dev/live-sessions', async () => {
    await resetDatabase(ctx.db);
    const { ownerId } = await createVendor(ctx.db);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/dev/live-sessions/${ulid()}/encoder`,
      headers: await ctx.authHeader(ownerId),
      payload: { connected: true },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ errorCode: 'common.error.not-found', params: {} });
  });
});
