import { deriveUnsubscribeToken, hashUnsubscribeToken, type SubOrderStatus } from '@repo/core';
import { ulid } from 'ulid';
import { type TestApp, createTestApp, makeUser, makeVendor } from '../support';

type User = Awaited<ReturnType<typeof makeUser>>;

describe('CRM consent: vendor preferences + unsubscribe', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function makeSubOrder(customerId: string, vendorId: string, status: SubOrderStatus) {
    await t.db.order.create({
      data: {
        id: ulid(),
        customerId,
        status: 'PAID',
        currency: 'VND',
        itemsTotalAmount: 100_000n,
        shippingTotalAmount: 0n,
        grandTotalAmount: 100_000n,
        idempotencyKey: ulid(),
        subOrders: {
          create: {
            id: ulid(),
            vendorId,
            status,
            subtotalAmount: 100_000n,
            shippingAmount: 0n,
            currency: 'VND',
            shippingAddress: {},
          },
        },
      },
    });
  }

  const put = async (user: User, vendorId: string, payload: unknown) => {
    const res = await t.app.inject({
      method: 'PUT',
      url: `/v1/me/vendor-preferences/${vendorId}`,
      headers: { ...(await t.authHeader(user)), 'idempotency-key': ulid() },
      payload: payload as object,
    });
    return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
  };
  const list = async (user: User) => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/v1/me/vendor-preferences',
      headers: await t.authHeader(user),
    });
    return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown>[] };
  };
  const unsubscribe = (payload: unknown, remoteAddress?: string) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/crm/unsubscribe',
      payload: payload as object,
      ...(remoteAddress ? { remoteAddress } : {}),
    });
  const pref = (userId: string, vendorId: string) =>
    t.db.customerVendorPreference.findUniqueOrThrow({
      where: { userId_vendorId: { userId, vendorId } },
    });
  const events = (userId: string, vendorId: string) =>
    t.db.crmConsentEvent.findMany({
      where: { userId, vendorId },
      orderBy: { id: 'asc' },
      select: { action: true, source: true },
    });
  const tokenFor = (userId: string, vendorId: string) =>
    deriveUnsubscribeToken(t.env.CRM_UNSUBSCRIBE_SECRET, userId, vendorId);

  async function setup() {
    const { vendor } = await makeVendor(t.db, { displayName: 'Shop A' });
    const customer = await makeUser(t.db);
    await makeSubOrder(customer.id, vendor.id, 'COMPLETED');
    return { vendor, customer };
  }

  describe('GET /v1/me/vendor-preferences', () => {
    it('lists shops with a valid order or a preference row, with vendorName', async () => {
      const { vendor, customer } = await setup();
      const { vendor: viaPref } = await makeVendor(t.db, { displayName: 'Shop B' });
      const { vendor: refundedOnly } = await makeVendor(t.db, { displayName: 'Shop C' });
      const { vendor: unrelated } = await makeVendor(t.db, { displayName: 'Shop D' });
      await makeSubOrder(customer.id, refundedOnly.id, 'REFUNDED');
      await t.db.customerVendorPreference.create({
        data: { userId: customer.id, vendorId: viaPref.id, unsubscribeTokenHash: 'h'.repeat(64) },
      });

      const res = await list(customer);
      expect(res.status).toBe(200);
      expect(res.json.map((p) => p.vendorName)).toEqual(['Shop A', 'Shop B']);
      expect(res.json.map((p) => p.vendorId)).toEqual([vendor.id, viaPref.id]);
      expect(res.json[0]).toMatchObject({ marketingOptIn: false, serviceOptOut: false });
      // No preference row yet: updatedAt is the latest valid order time, never the epoch.
      expect(new Date(String(res.json[0]?.updatedAt)).getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(res.json.some((p) => p.vendorId === unrelated.id)).toBe(false);
    });
  });

  describe('PUT /v1/me/vendor-preferences/:vendorId', () => {
    it('opt-in then opt-out writes timestamps, source and consent events', async () => {
      const { vendor, customer } = await setup();

      const optIn = await put(customer, vendor.id, { marketingOptIn: true });
      expect(optIn.status).toBe(200);
      expect(optIn.json).toMatchObject({
        vendorId: vendor.id,
        vendorName: 'Shop A',
        marketingOptIn: true,
        serviceOptOut: false,
      });
      let row = await pref(customer.id, vendor.id);
      expect(row.marketingOptInAt).not.toBeNull();
      expect(row.marketingOptInSource).toBe('STOREFRONT');
      expect(row.marketingOptOutAt).toBeNull();
      expect(row.unsubscribeTokenHash).toBe(
        await hashUnsubscribeToken(await tokenFor(customer.id, vendor.id)),
      );

      const optOut = await put(customer, vendor.id, { marketingOptIn: false });
      expect(optOut.json).toMatchObject({ marketingOptIn: false });
      row = await pref(customer.id, vendor.id);
      expect(row.marketingOptOutAt).not.toBeNull();
      expect(row.marketingOptInAt).not.toBeNull();

      expect(await events(customer.id, vendor.id)).toEqual([
        { action: 'MARKETING_OPT_IN', source: 'STOREFRONT' },
        { action: 'MARKETING_OPT_OUT', source: 'STOREFRONT' },
      ]);
    });

    it('re-opt-in after opt-out restores consent', async () => {
      const { vendor, customer } = await setup();
      await put(customer, vendor.id, { marketingOptIn: true });
      await put(customer, vendor.id, { marketingOptIn: false });
      const again = await put(customer, vendor.id, { marketingOptIn: true });
      expect(again.json).toMatchObject({ marketingOptIn: true });
      expect((await list(customer)).json[0]).toMatchObject({ marketingOptIn: true });
      expect((await events(customer.id, vendor.id)).map((e) => e.action)).toEqual([
        'MARKETING_OPT_IN',
        'MARKETING_OPT_OUT',
        'MARKETING_OPT_IN',
      ]);
    });

    it('toggles service opt-out with set/clear of serviceOptOutAt and events', async () => {
      const { vendor, customer } = await setup();
      const off = await put(customer, vendor.id, { serviceOptOut: true });
      expect(off.json).toMatchObject({ serviceOptOut: true, marketingOptIn: false });
      expect((await pref(customer.id, vendor.id)).serviceOptOutAt).not.toBeNull();
      const on = await put(customer, vendor.id, { serviceOptOut: false });
      expect(on.json).toMatchObject({ serviceOptOut: false });
      expect((await pref(customer.id, vendor.id)).serviceOptOutAt).toBeNull();
      expect((await events(customer.id, vendor.id)).map((e) => e.action)).toEqual([
        'SERVICE_OPT_OUT',
        'SERVICE_OPT_IN',
      ]);
    });

    it('writes no event for a no-op change', async () => {
      const { vendor, customer } = await setup();
      await put(customer, vendor.id, { marketingOptIn: false, serviceOptOut: false });
      expect(await events(customer.id, vendor.id)).toEqual([]);
      await put(customer, vendor.id, { marketingOptIn: true });
      const before = await pref(customer.id, vendor.id);
      await put(customer, vendor.id, { marketingOptIn: true });
      const after = await pref(customer.id, vendor.id);
      expect(after.marketingOptInAt).toEqual(before.marketingOptInAt);
      expect(await events(customer.id, vendor.id)).toHaveLength(1);
    });

    it('404 vendor.error.not-found for a shop never bought from, a refunded-only shop, or unknown id', async () => {
      const { customer } = await setup();
      const { vendor: stranger } = await makeVendor(t.db);
      const { vendor: refunded } = await makeVendor(t.db);
      await makeSubOrder(customer.id, refunded.id, 'REFUNDED');
      for (const id of [stranger.id, refunded.id, ulid()]) {
        const res = await put(customer, id, { marketingOptIn: true });
        expect(res.status).toBe(404);
        expect(res.json).toEqual({ errorCode: 'vendor.error.not-found', params: {} });
      }
      expect(await t.db.customerVendorPreference.count()).toBe(0);
    });

    it('rejects an empty body (422) and non-customers (403)', async () => {
      const { vendor, customer } = await setup();
      expect((await put(customer, vendor.id, {})).status).toBe(422);
      const staff = await makeUser(t.db, { roles: ['PLATFORM_STAFF'] });
      expect((await put(staff, vendor.id, { marketingOptIn: true })).status).toBe(403);
    });
  });

  describe('consent races', () => {
    it('two concurrent identical opt-ins write exactly one event', async () => {
      const { vendor, customer } = await setup();
      const results = await Promise.all([
        put(customer, vendor.id, { marketingOptIn: true }),
        put(customer, vendor.id, { marketingOptIn: true }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await events(customer.id, vendor.id)).toEqual([
        { action: 'MARKETING_OPT_IN', source: 'STOREFRONT' },
      ]);
    });

    it('concurrent first-time PUTs (no row yet) never 500', async () => {
      const { vendor, customer } = await setup();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => put(customer, vendor.id, { serviceOptOut: true })),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(await t.db.customerVendorPreference.count()).toBe(1);
      expect(await events(customer.id, vendor.id)).toHaveLength(1);
    });

    it('unsubscribe racing an opt-in leaves state consistent with the last event', async () => {
      for (let round = 0; round < 5; round += 1) {
        await t.reset();
        const { vendor, customer } = await setup();
        await put(customer, vendor.id, { marketingOptIn: true });
        const token = await tokenFor(customer.id, vendor.id);
        await put(customer, vendor.id, { marketingOptIn: false });
        await Promise.all([
          put(customer, vendor.id, { marketingOptIn: true }),
          unsubscribe({ token, scope: 'MARKETING' }),
        ]);
        const log = await t.db.crmConsentEvent.findMany({
          where: {
            userId: customer.id,
            vendorId: vendor.id,
            action: { in: ['MARKETING_OPT_IN', 'MARKETING_OPT_OUT'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const row = await pref(customer.id, vendor.id);
        const consented =
          row.marketingOptInAt !== null &&
          (row.marketingOptOutAt === null || row.marketingOptInAt > row.marketingOptOutAt);
        expect(consented).toBe(log.at(-1)?.action === 'MARKETING_OPT_IN');
      }
    });
  });

  describe('POST /v1/crm/unsubscribe', () => {
    async function optedIn() {
      const { vendor, customer } = await setup();
      await put(customer, vendor.id, { marketingOptIn: true });
      return { vendor, customer, token: await tokenFor(customer.id, vendor.id) };
    }

    it('answers 404 crm.error.unsubscribe-invalid for an unknown token', async () => {
      await optedIn();
      const res = await unsubscribe({ token: 'A'.repeat(43), scope: 'MARKETING' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ errorCode: 'crm.error.unsubscribe-invalid', params: {} });
    });

    it('rejects a malformed token (422)', async () => {
      const res = await unsubscribe({ token: 'short', scope: 'MARKETING' });
      expect(res.statusCode).toBe(422);
    });

    it('MARKETING opts out of marketing only, source UNSUBSCRIBE_LINK', async () => {
      const { vendor, customer, token } = await optedIn();
      const res = await unsubscribe({ token, scope: 'MARKETING' });
      expect(res.statusCode).toBe(204);
      const row = await pref(customer.id, vendor.id);
      expect(row.marketingOptOutAt).not.toBeNull();
      expect(row.serviceOptOutAt).toBeNull();
      expect(await events(customer.id, vendor.id)).toEqual([
        { action: 'MARKETING_OPT_IN', source: 'STOREFRONT' },
        { action: 'MARKETING_OPT_OUT', source: 'UNSUBSCRIBE_LINK' },
      ]);
      expect((await list(customer)).json[0]).toMatchObject({ marketingOptIn: false });
    });

    it('ALL also opts out of service messages', async () => {
      const { vendor, customer, token } = await optedIn();
      expect((await unsubscribe({ token, scope: 'ALL' })).statusCode).toBe(204);
      const row = await pref(customer.id, vendor.id);
      expect(row.marketingOptOutAt).not.toBeNull();
      expect(row.serviceOptOutAt).not.toBeNull();
      expect((await events(customer.id, vendor.id)).slice(1)).toEqual([
        { action: 'MARKETING_OPT_OUT', source: 'UNSUBSCRIBE_LINK' },
        { action: 'SERVICE_OPT_OUT', source: 'UNSUBSCRIBE_LINK' },
      ]);
    });

    it('is idempotent: a repeat writes no new events or timestamps', async () => {
      const { vendor, customer, token } = await optedIn();
      await unsubscribe({ token, scope: 'ALL' });
      const before = await pref(customer.id, vendor.id);
      const eventCount = (await events(customer.id, vendor.id)).length;
      for (const scope of ['ALL', 'MARKETING'] as const) {
        expect((await unsubscribe({ token, scope })).statusCode).toBe(204);
      }
      const after = await pref(customer.id, vendor.id);
      expect(after.marketingOptOutAt).toEqual(before.marketingOptOutAt);
      expect(after.serviceOptOutAt).toEqual(before.serviceOptOutAt);
      expect(await events(customer.id, vendor.id)).toHaveLength(eventCount);
    });

    it('works for a customer whose preference row was created by opt-in only (stored hash matches derived token)', async () => {
      const { vendor, customer } = await setup();
      await put(customer, vendor.id, { serviceOptOut: false });
      const token = await tokenFor(customer.id, vendor.id);
      expect((await unsubscribe({ token, scope: 'MARKETING' })).statusCode).toBe(204);
      expect(await events(customer.id, vendor.id)).toEqual([]);
    });
  });

  describe('POST /v1/crm/unsubscribe/one-click (RFC 8058)', () => {
    const oneClick = (query: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/crm/unsubscribe/one-click?${query}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'List-Unsubscribe=One-Click',
      });

    it('accepts the mail client form POST with token + scope in the query', async () => {
      const { vendor, customer } = await setup();
      await put(customer, vendor.id, { marketingOptIn: true });
      const token = await tokenFor(customer.id, vendor.id);
      const res = await oneClick(new URLSearchParams({ token, scope: 'ALL' }).toString());
      expect(res.statusCode).toBe(204);
      const row = await pref(customer.id, vendor.id);
      expect(row.marketingOptOutAt).not.toBeNull();
      expect(row.serviceOptOutAt).not.toBeNull();
      expect((await events(customer.id, vendor.id)).slice(1)).toEqual([
        { action: 'MARKETING_OPT_OUT', source: 'UNSUBSCRIBE_LINK' },
        { action: 'SERVICE_OPT_OUT', source: 'UNSUBSCRIBE_LINK' },
      ]);
    });

    it('answers 404 for an unknown token and 422 without a scope', async () => {
      await setup();
      const unknown = await oneClick(`token=${'A'.repeat(43)}&scope=MARKETING`);
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json()).toEqual({ errorCode: 'crm.error.unsubscribe-invalid', params: {} });
      expect((await oneClick(`token=${'A'.repeat(43)}`)).statusCode).toBe(422);
    });
  });
});

describe('POST /v1/crm/unsubscribe rate limit', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { RATE_LIMIT_UNSUBSCRIBE_MAX: '2', RATE_LIMIT_WINDOW: '1m' } });
  });
  afterAll(() => t.close());

  it('answers 429 common.error.rate-limited past the strict per-IP limit', async () => {
    const send = () =>
      t.app.inject({
        method: 'POST',
        url: '/v1/crm/unsubscribe',
        remoteAddress: '203.0.113.50',
        payload: { token: 'A'.repeat(43), scope: 'MARKETING' },
      });
    expect((await send()).statusCode).toBe(404);
    expect((await send()).statusCode).toBe(404);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ errorCode: 'common.error.rate-limited', params: {} });
  });
});
