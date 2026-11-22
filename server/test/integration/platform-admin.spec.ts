import { ulid } from 'ulid';
import {
  type TestApp,
  createTestApp,
  makeAddress,
  makePlatformSettings,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

interface Json {
  [key: string]: unknown;
}
interface PageBody {
  items: Json[];
  nextCursor: string | null;
}
interface ErrorBody {
  errorCode: string;
}

type User = Parameters<TestApp['authHeader']>[0];

describe('platform admin API (Testcontainers)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db, { commissionBps: 1000 });
  });

  async function call(user: User | null, method: string, url: string, payload?: object) {
    const headers: Record<string, string> = user ? { ...(await t.authHeader(user)) } : {};
    if (method !== 'GET') headers['idempotency-key'] = ulid();
    const res = await t.app.inject({
      method: method as 'GET',
      url: `/v1${url}`,
      headers,
      ...(payload && { payload }),
    });
    const body: unknown = res.body ? res.json() : null;
    return { status: res.statusCode, body };
  }
  const asJson = (v: unknown) => v as Json;
  const asPage = (v: unknown) => v as PageBody;
  const code = (v: unknown) => (v as ErrorBody).errorCode;

  const staff = () => makeUser(t.db, { roles: ['PLATFORM_STAFF'] });
  const admin = () => makeUser(t.db, { roles: ['PLATFORM_ADMIN'] });

  describe('permissions', () => {
    it('customers, vendors and anonymous callers get 403 / 401 on every endpoint', async () => {
      const customer = await makeUser(t.db);
      const { vendor, owner } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id });
      const id = ulid();
      const endpoints: [string, string, object?][] = [
        ['GET', '/platform/settings'],
        ['PATCH', '/platform/settings', { holdPeriodDays: 3 }],
        ['GET', '/platform/vendors'],
        ['POST', `/platform/vendors/${vendor.id}/suspend`, { reason: 'x' }],
        ['POST', `/platform/vendors/${vendor.id}/reactivate`],
        ['GET', '/platform/products'],
        ['POST', `/platform/products/${product.id}/block`, { reason: 'x' }],
        ['POST', `/platform/products/${product.id}/unblock`],
        ['GET', '/platform/orders'],
        ['GET', `/platform/orders/${id}`],
        ['GET', '/platform/users'],
        ['POST', `/platform/users/${customer.id}/roles`, { role: 'PLATFORM_STAFF' }],
        ['DELETE', `/platform/users/${customer.id}/roles/PLATFORM_STAFF`],
      ];
      for (const [method, url, payload] of endpoints) {
        for (const who of [customer, owner]) {
          expect({ url, status: (await call(who, method, url, payload)).status }).toEqual({
            url,
            status: 403,
          });
        }
        expect((await call(null, method, url, payload)).status).toBe(401);
      }
    });

    it('staff may read and moderate, but not change settings or roles', async () => {
      const s = await staff();
      const target = await makeUser(t.db);
      const { vendor } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id });

      expect((await call(s, 'GET', '/platform/settings')).status).toBe(200);
      expect((await call(s, 'PATCH', '/platform/settings', { holdPeriodDays: 3 })).status).toBe(
        403,
      );
      expect((await call(s, 'GET', '/platform/vendors')).status).toBe(200);
      expect(
        (await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, { reason: 'r' })).status,
      ).toBe(200);
      expect((await call(s, 'POST', `/platform/vendors/${vendor.id}/reactivate`)).status).toBe(200);
      expect((await call(s, 'GET', '/platform/products')).status).toBe(200);
      expect(
        (await call(s, 'POST', `/platform/products/${product.id}/block`, { reason: 'r' })).status,
      ).toBe(200);
      expect((await call(s, 'POST', `/platform/products/${product.id}/unblock`)).status).toBe(200);
      expect((await call(s, 'GET', '/platform/orders')).status).toBe(200);
      expect((await call(s, 'GET', '/platform/users')).status).toBe(200);
      expect(
        (await call(s, 'POST', `/platform/users/${target.id}/roles`, { role: 'PLATFORM_STAFF' }))
          .status,
      ).toBe(403);
      expect(
        (await call(s, 'DELETE', `/platform/users/${target.id}/roles/PLATFORM_STAFF`)).status,
      ).toBe(403);
    });

    it('admins can do everything staff can, plus settings and roles', async () => {
      const a = await admin();
      const { vendor } = await makeVendor(t.db);
      expect(
        (await call(a, 'POST', `/platform/vendors/${vendor.id}/suspend`, { reason: 'r' })).status,
      ).toBe(200);
      expect((await call(a, 'PATCH', '/platform/settings', { holdPeriodDays: 3 })).status).toBe(
        200,
      );
    });

    it('mutations require an Idempotency-Key', async () => {
      const a = await admin();
      const res = await t.app.inject({
        method: 'PATCH',
        url: '/v1/platform/settings',
        headers: await t.authHeader(a),
        payload: { holdPeriodDays: 3 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('settings', () => {
    it('reads and partially updates; untouched fields stay', async () => {
      const a = await admin();
      const before = asJson((await call(a, 'GET', '/platform/settings')).body);
      expect(before.commissionBps).toBe(1000);
      const res = await call(a, 'PATCH', '/platform/settings', {
        commissionBps: 1500,
        refundWindowDays: 14,
      });
      expect(res.status).toBe(200);
      expect(asJson(res.body)).toMatchObject({
        commissionBps: 1500,
        refundWindowDays: 14,
        holdPeriodDays: before.holdPeriodDays,
      });
      expect(asJson((await call(a, 'GET', '/platform/settings')).body).commissionBps).toBe(1500);
    });

    it.each([
      [{ commissionBps: 10_001 }],
      [{ commissionBps: -1 }],
      [{ holdPeriodDays: -1 }],
      [{ refundWindowDays: 1.5 }],
      [{ paymentTimeoutMinutes: 0 }],
      [{ maxCouponStack: 0 }],
      [{ supportedCurrencies: [] }],
      [{ supportedCurrencies: ['VND'], defaultCurrency: 'USD' }],
      [{}],
    ])('rejects invalid body %j with 422', async (body) => {
      const a = await admin();
      const res = await call(a, 'PATCH', '/platform/settings', body);
      expect(res.status).toBe(422);
    });

    it('keeps the stored default currency inside the supported set', async () => {
      const a = await admin();
      // stored default is VND; dropping VND alone must be refused
      const res = await call(a, 'PATCH', '/platform/settings', { supportedCurrencies: ['USD'] });
      expect(res.status).toBe(422);
      expect(code(res.body)).toBe('common.error.validation-failed');
      const ok = await call(a, 'PATCH', '/platform/settings', {
        supportedCurrencies: ['USD'],
        defaultCurrency: 'USD',
      });
      expect(ok.status).toBe(200);
    });
  });

  describe('vendors', () => {
    it('lists with status and q filters', async () => {
      const s = await staff();
      const a = await makeVendor(t.db, { displayName: 'Alpha Shop' });
      const b = await makeVendor(t.db, { displayName: 'Beta Shop', status: 'SUSPENDED' });
      const all = asPage((await call(s, 'GET', '/platform/vendors')).body);
      expect(all.items.map((v) => v.id)).toEqual([b.vendor.id, a.vendor.id]);
      const suspended = asPage((await call(s, 'GET', '/platform/vendors?status=SUSPENDED')).body);
      expect(suspended.items.map((v) => v.id)).toEqual([b.vendor.id]);
      const byName = asPage((await call(s, 'GET', '/platform/vendors?q=alpha')).body);
      expect(byName.items.map((v) => v.id)).toEqual([a.vendor.id]);
      const byEmail = asPage(
        (await call(s, 'GET', `/platform/vendors?q=${encodeURIComponent(a.owner.email ?? '')}`))
          .body,
      );
      expect(byEmail.items.map((v) => v.id)).toEqual([a.vendor.id]);
      const paged = asPage((await call(s, 'GET', '/platform/vendors?limit=1')).body);
      expect(paged.items).toHaveLength(1);
      expect(paged.nextCursor).not.toBeNull();
    });

    it('suspend hides the products from catalog, cart and checkout; reactivate restores them', async () => {
      const s = await staff();
      const { vendor } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');
      const method = await makeShippingMethod(t.db, { vendorId: vendor.id });
      const buyer = await makeUser(t.db);
      const address = await makeAddress(t.db, { userId: buyer.id, isDefault: true });
      const buyerCall = (m: string, url: string, payload?: object) => call(buyer, m, url, payload);
      const visible = async () =>
        asPage((await call(null, 'GET', '/products')).body).items.map((p) => p.id);

      await buyerCall('PUT', `/cart/items/${variant.id}`, { quantity: 1 });
      expect(await visible()).toContain(product.id);

      const res = await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, {
        reason: 'counterfeit goods',
      });
      expect(res.status).toBe(200);
      expect(asJson(res.body)).toMatchObject({
        status: 'SUSPENDED',
        suspendedReason: 'counterfeit goods',
      });

      expect(await visible()).not.toContain(product.id);
      const cart = asJson((await buyerCall('GET', '/cart')).body);
      expect(JSON.stringify(cart)).toContain('"unavailable":true');
      const put = await buyerCall('PUT', `/cart/items/${variant.id}`, { quantity: 2 });
      expect(put.status).toBe(409);
      expect(code(put.body)).toBe('product.error.not-available');
      const checkout = await buyerCall('POST', '/orders/checkout', {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      });
      expect(checkout.status).toBe(409);
      expect(code(checkout.body)).toBe('product.error.not-available');

      const back = await call(s, 'POST', `/platform/vendors/${vendor.id}/reactivate`);
      expect(asJson(back.body)).toMatchObject({ status: 'ACTIVE', suspendedReason: null });
      expect(await visible()).toContain(product.id);
    });

    it('a suspended vendor cannot write even with an unexpired token', async () => {
      const s = await staff();
      const { vendor, owner } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id, status: 'DRAFT' });
      const ownerHeaders = await t.authHeader(owner); // token issued while ACTIVE
      await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, { reason: 'r' });
      const res = await t.app.inject({
        method: 'POST',
        url: `/v1/vendor/products/${product.id}/publish`,
        headers: { ...ownerHeaders, 'idempotency-key': ulid() },
      });
      expect(res.statusCode).toBe(403);
      expect(code(res.json())).toBe('vendor.error.suspended');
    });

    it('guards transitions, unknown ids and a blank reason', async () => {
      const s = await staff();
      const { vendor } = await makeVendor(t.db);
      const reactivateActive = await call(s, 'POST', `/platform/vendors/${vendor.id}/reactivate`);
      expect(reactivateActive.status).toBe(409);
      expect((await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, {})).status).toBe(
        422,
      );
      expect(
        (await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, { reason: ' ' })).status,
      ).toBe(422);
      await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, { reason: 'r' });
      const again = await call(s, 'POST', `/platform/vendors/${vendor.id}/suspend`, {
        reason: 'r',
      });
      expect(again.status).toBe(409);
      const missing = await call(s, 'POST', `/platform/vendors/${ulid()}/suspend`, { reason: 'r' });
      expect(missing.status).toBe(404);
      expect(code(missing.body)).toBe('vendor.error.not-found');
    });
  });

  describe('products', () => {
    it('lists with status, vendorId and q filters', async () => {
      const s = await staff();
      const v1 = await makeVendor(t.db);
      const v2 = await makeVendor(t.db);
      const p1 = await makeProduct(t.db, { vendorId: v1.vendor.id, name: 'Red Lamp' });
      const p2 = await makeProduct(t.db, {
        vendorId: v2.vendor.id,
        status: 'DRAFT',
        name: 'Chair',
      });
      const ids = async (qs: string) =>
        asPage((await call(s, 'GET', `/platform/products${qs}`)).body).items.map((p) => p.id);
      expect(await ids('')).toEqual([p2.id, p1.id]);
      expect(await ids('?status=DRAFT')).toEqual([p2.id]);
      expect(await ids(`?vendorId=${v1.vendor.id}`)).toEqual([p1.id]);
      expect(await ids('?q=lamp')).toEqual([p1.id]);
      const first = asPage((await call(s, 'GET', '/platform/products')).body).items[0];
      expect(first).toMatchObject({ vendorName: 'Test Vendor', status: 'DRAFT' });
    });

    it('block hides the product and stops the vendor publishing; unblock returns it to DRAFT', async () => {
      const s = await staff();
      const { vendor, owner } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id });
      const publicIds = async () =>
        asPage((await call(null, 'GET', '/products')).body).items.map((p) => p.id);
      expect(await publicIds()).toContain(product.id);

      const blocked = await call(s, 'POST', `/platform/products/${product.id}/block`, {
        reason: 'prohibited item',
      });
      expect(asJson(blocked.body)).toMatchObject({
        status: 'BLOCKED',
        blockedReason: 'prohibited item',
      });
      expect(await publicIds()).not.toContain(product.id);

      const publish = await call(owner, 'POST', `/vendor/products/${product.id}/publish`);
      expect(publish.status).toBe(409);
      expect(code(publish.body)).toBe('product.error.blocked');
      expect(
        (await call(s, 'POST', `/platform/products/${product.id}/block`, { reason: 'again' }))
          .status,
      ).toBe(409);

      const unblocked = await call(s, 'POST', `/platform/products/${product.id}/unblock`);
      expect(asJson(unblocked.body)).toMatchObject({ status: 'DRAFT', blockedReason: null });
      expect(await publicIds()).not.toContain(product.id);
      expect((await call(owner, 'POST', `/vendor/products/${product.id}/publish`)).status).toBe(
        200,
      );
      expect(await publicIds()).toContain(product.id);
      expect((await call(s, 'POST', `/platform/products/${product.id}/unblock`)).status).toBe(409);
    });

    it('404s unknown products and rejects a blank reason', async () => {
      const s = await staff();
      expect(
        (await call(s, 'POST', `/platform/products/${ulid()}/block`, { reason: 'r' })).status,
      ).toBe(404);
      const { vendor } = await makeVendor(t.db);
      const product = await makeProduct(t.db, { vendorId: vendor.id });
      expect(
        (await call(s, 'POST', `/platform/products/${product.id}/block`, { reason: '' })).status,
      ).toBe(422);
    });
  });

  describe('orders', () => {
    async function placeOrder(email: string) {
      const buyer = await makeUser(t.db, { email });
      const address = await makeAddress(t.db, { userId: buyer.id, isDefault: true });
      const { vendor } = await makeVendor(t.db, { displayName: 'Order Shop' });
      const product = await makeProduct(t.db, { vendorId: vendor.id, price: 100_000 });
      const method = await makeShippingMethod(t.db, { vendorId: vendor.id, price: 30_000 });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');
      const res = await call(buyer, 'POST', '/orders/checkout', {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      });
      expect(res.status).toBe(201);
      return { buyer, vendor, order: asJson(res.body) as { id: string } & Json };
    }

    it('searches by order id (full and prefix), customer email and status', async () => {
      const s = await staff();
      const one = await placeOrder('alice@example.com');
      const two = await placeOrder('bob@example.com');
      const ids = async (qs: string) =>
        asPage((await call(s, 'GET', `/platform/orders${qs}`)).body).items.map((o) => o.id);
      expect(await ids('')).toEqual([two.order.id, one.order.id]);
      expect(await ids(`?q=${one.order.id}`)).toEqual([one.order.id]);
      expect(await ids(`?q=${one.order.id.toLowerCase()}`)).toEqual([one.order.id]);
      expect(await ids('?q=BOB@')).toEqual([two.order.id]);
      expect(await ids('?q=nobody')).toEqual([]);
      expect(await ids('?status=PAID')).toEqual([]);
      expect(await ids('?status=AWAITING_PAYMENT')).toHaveLength(2);
      const item = asPage((await call(s, 'GET', '/platform/orders?q=alice')).body).items[0];
      expect(item).toMatchObject({
        customerEmail: 'alice@example.com',
        subOrderCount: 1,
        grandTotal: { amount: 130_000, currency: 'VND' },
      });
    });

    it('returns the detail with sub-orders, payments (no raw payload), ledger and refunds', async () => {
      const s = await staff();
      const { buyer, order } = await placeOrder('carol@example.com');
      const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
      await t.db.payment.update({
        where: { id: payment.id },
        data: {
          rawPayload: { secret: 'provider-secret' },
          redirectUrl: 'https://pay.example.com/session',
        },
      });
      const subOrder = await t.db.subOrder.findFirstOrThrow({ where: { orderId: order.id } });
      const txnGroupId = ulid();
      await t.db.ledgerEntry.createMany({
        data: [
          {
            id: ulid(),
            txnGroupId,
            account: 'CUSTOMER',
            entryType: 'ESCROW_IN',
            amount: -130_000n,
            currency: 'VND',
            orderId: order.id,
            subOrderId: subOrder.id,
          },
          {
            id: ulid(),
            txnGroupId,
            account: 'PLATFORM_ESCROW',
            entryType: 'ESCROW_IN',
            amount: 130_000n,
            currency: 'VND',
            orderId: order.id,
            subOrderId: subOrder.id,
          },
        ],
      });
      const refund = await t.db.refund.create({
        data: {
          id: ulid(),
          subOrderId: subOrder.id,
          paymentId: payment.id,
          amount: 130_000n,
          currency: 'VND',
          reason: 'damaged',
          requestedById: buyer.id,
        },
      });

      const res = await call(s, 'GET', `/platform/orders/${order.id}`);
      expect(res.status).toBe(200);
      const body = asJson(res.body);
      expect(body).toMatchObject({
        id: order.id,
        customerEmail: 'carol@example.com',
        customerId: buyer.id,
        grandTotal: { amount: 130_000, currency: 'VND' },
      });
      expect(body.subOrders).toHaveLength(1);
      expect(body.payments).toEqual([
        expect.objectContaining({
          id: payment.id,
          provider: 'VNPAY',
          status: 'PENDING',
          amount: { amount: 130_000, currency: 'VND' },
        }),
      ]);
      expect(res.body && JSON.stringify(res.body)).not.toMatch(
        /provider-secret|rawPayload|pay\.example/,
      );
      const ledger = body.ledgerEntries as { amount: { amount: number } }[];
      expect(ledger.map((e) => e.amount.amount).sort((x, y) => x - y)).toEqual([-130_000, 130_000]);
      expect(body.refunds).toEqual([
        expect.objectContaining({ id: refund.id, subOrderId: subOrder.id, reason: 'damaged' }),
      ]);
    });

    it('404s an unknown order', async () => {
      const s = await staff();
      const res = await call(s, 'GET', `/platform/orders/${ulid()}`);
      expect(res.status).toBe(404);
      expect(code(res.body)).toBe('order.error.not-found');
    });
  });

  describe('users and roles', () => {
    it('searches users by email and name', async () => {
      const s = await staff();
      const u1 = await makeUser(t.db, { email: 'dana@example.com', name: 'Dana Scully' });
      await makeUser(t.db, { email: 'other@example.com', name: 'Other' });
      const ids = async (q: string) =>
        asPage((await call(s, 'GET', `/platform/users?q=${encodeURIComponent(q)}`)).body).items.map(
          (u) => u.id,
        );
      expect(await ids('DANA@')).toEqual([u1.id]);
      expect(await ids('scully')).toEqual([u1.id]);
      expect((await ids('')).length).toBe(3);
    });

    it('grants and revokes platform roles', async () => {
      const a = await admin();
      const target = await makeUser(t.db);
      const granted = await call(a, 'POST', `/platform/users/${target.id}/roles`, {
        role: 'PLATFORM_STAFF',
      });
      expect(granted.status).toBe(200);
      expect(asJson(granted.body).roles).toEqual(
        expect.arrayContaining(['CUSTOMER', 'PLATFORM_STAFF']),
      );
      // granting again does not duplicate
      await call(a, 'POST', `/platform/users/${target.id}/roles`, { role: 'PLATFORM_STAFF' });
      expect(
        await t.db.userRole.count({ where: { userId: target.id, role: 'PLATFORM_STAFF' } }),
      ).toBe(1);
      // the new role takes effect on the next token
      expect((await call(target, 'GET', '/platform/settings')).status).toBe(200);

      const revoked = await call(a, 'DELETE', `/platform/users/${target.id}/roles/PLATFORM_STAFF`);
      expect(revoked.status).toBe(200);
      expect(asJson(revoked.body).roles).toEqual(['CUSTOMER']);
      expect((await call(target, 'GET', '/platform/settings')).status).toBe(403);
      // revoking a role not held is a no-op
      expect(
        (await call(a, 'DELETE', `/platform/users/${target.id}/roles/PLATFORM_STAFF`)).status,
      ).toBe(200);
    });

    it('rejects non-platform roles and unknown users', async () => {
      const a = await admin();
      const target = await makeUser(t.db);
      expect(
        (await call(a, 'POST', `/platform/users/${target.id}/roles`, { role: 'VENDOR_OWNER' }))
          .status,
      ).toBe(422);
      expect(
        (await call(a, 'DELETE', `/platform/users/${target.id}/roles/VENDOR_OWNER`)).status,
      ).toBe(422);
      expect(
        (await call(a, 'POST', `/platform/users/${ulid()}/roles`, { role: 'PLATFORM_STAFF' }))
          .status,
      ).toBe(404);
    });

    it('an admin cannot remove their own PLATFORM_ADMIN', async () => {
      const a = await admin();
      await admin(); // a second admin exists, so only the self-guard applies
      const res = await call(a, 'DELETE', `/platform/users/${a.id}/roles/PLATFORM_ADMIN`);
      expect(res.status).toBe(403);
      expect(code(res.body)).toBe('common.error.forbidden');
      expect(await t.db.userRole.count({ where: { userId: a.id, role: 'PLATFORM_ADMIN' } })).toBe(
        1,
      );
    });

    it('an admin may drop their own PLATFORM_STAFF', async () => {
      const a = await makeUser(t.db, { roles: ['PLATFORM_ADMIN', 'PLATFORM_STAFF'] });
      const res = await call(a, 'DELETE', `/platform/users/${a.id}/roles/PLATFORM_STAFF`);
      expect(res.status).toBe(200);
    });

    it('never removes the last PLATFORM_ADMIN, but another admin can demote a peer', async () => {
      const a1 = await admin();
      const a2 = await admin();
      const peer = await call(a1, 'DELETE', `/platform/users/${a2.id}/roles/PLATFORM_ADMIN`);
      expect(peer.status).toBe(200);
      // a1 is now the only admin; a stale token of a2 (demoted, still within 15 min) tries the reverse
      const stale = await t.signAccessToken(a2, ['PLATFORM_ADMIN']);
      const res = await t.app.inject({
        method: 'DELETE',
        url: `/v1/platform/users/${a1.id}/roles/PLATFORM_ADMIN`,
        headers: { authorization: `Bearer ${stale}`, 'idempotency-key': ulid() },
      });
      expect(res.statusCode).toBe(409);
      expect(code(res.json())).toBe('common.error.conflict');
      expect(await t.db.userRole.count({ where: { role: 'PLATFORM_ADMIN' } })).toBe(1);
    });

    it('concurrent demotions of the last two admins leave one', async () => {
      const a1 = await admin();
      const a2 = await admin();
      const [r1, r2] = await Promise.all([
        call(a1, 'DELETE', `/platform/users/${a2.id}/roles/PLATFORM_ADMIN`),
        call(a2, 'DELETE', `/platform/users/${a1.id}/roles/PLATFORM_ADMIN`),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(await t.db.userRole.count({ where: { role: 'PLATFORM_ADMIN' } })).toBe(1);
    });
  });
});
