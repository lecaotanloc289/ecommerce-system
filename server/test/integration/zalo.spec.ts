import {
  ZALO_LOGIN_QUEUE_KEY,
  ZaloLoginRecordSchema,
  type ZaloAccountStatus,
  zaloLoginKey,
} from '@repo/core';
import { ulid } from 'ulid';
import { queueZaloStatusMessages } from '../../src/zalo/zalo-message-queue';
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

interface ErrorBody {
  errorCode: string;
  params: Record<string, unknown>;
}

interface TemplateBody {
  event: string;
  isEnabled: boolean;
  body: string | null;
  delayMinutes: number;
  updatedAt: string | null;
}

interface MessagePageBody {
  items: { id: string; orderId: string; subOrderId: string; event: string; status: string }[];
  nextCursor: string | null;
}

describe('vendor Zalo API + message queue (Testcontainers)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db, { commissionBps: 1000 });
  });

  const get = (headers: Record<string, string>, url: string) =>
    t.app.inject({ method: 'GET', url, headers });

  const send = (
    method: 'POST' | 'PUT',
    headers: Record<string, string>,
    url: string,
    payload?: object,
  ) =>
    t.app.inject({
      method,
      url,
      headers: { ...headers, 'idempotency-key': ulid() },
      ...(payload && { payload }),
    });

  async function vendorWithOwner(options: { name?: string } = {}) {
    const { vendor, owner } = await makeVendor(t.db, { displayName: options.name ?? 'Shop' });
    return { vendor, owner, headers: await t.authHeader(owner) };
  }

  const addAccount = (vendorId: string, status: ZaloAccountStatus = 'ACTIVE') =>
    t.db.zaloAccount.create({
      data: {
        id: ulid(),
        vendorId,
        status,
        zaloUid: status === 'DISCONNECTED' ? null : `uid-${ulid()}`,
        displayName: 'Shop Zalo',
        avatarUrl: 'https://example.com/a.png',
        credentials: status === 'DISCONNECTED' ? null : 'v1:ciphertext',
        lastLoginAt: new Date('2026-11-20T00:00:00Z'),
      },
    });

  describe('access', () => {
    it('needs a signed-in vendor; staff can read but not manage the account', async () => {
      expect(
        (await t.app.inject({ method: 'GET', url: '/v1/vendor/zalo/account' })).statusCode,
      ).toBe(401);
      const customer = await makeUser(t.db);
      expect(
        (await get(await t.authHeader(customer), '/v1/vendor/zalo/templates')).statusCode,
      ).toBe(403);

      const { vendor } = await vendorWithOwner();
      const staff = await makeUser(t.db, { roles: ['VENDOR_STAFF'], vendorId: vendor.id });
      const staffHeaders = await t.authHeader(staff);
      expect((await get(staffHeaders, '/v1/vendor/zalo/account')).statusCode).toBe(200);
      expect((await get(staffHeaders, '/v1/vendor/zalo/templates')).statusCode).toBe(200);
      expect((await get(staffHeaders, '/v1/vendor/zalo/messages')).statusCode).toBe(200);
      expect(
        (
          await send('PUT', staffHeaders, '/v1/vendor/zalo/templates/ORDER_PLACED', {
            isEnabled: true,
            body: 'Hi {{customerName}}',
          })
        ).statusCode,
      ).toBe(200);
      expect((await send('POST', staffHeaders, '/v1/vendor/zalo/login-requests')).statusCode).toBe(
        403,
      );
      expect(
        (await send('POST', staffHeaders, '/v1/vendor/zalo/account/disconnect')).statusCode,
      ).toBe(403);
    });

    it('owner of another shop cannot act as owner of the shop it only staffs', async () => {
      const a = await vendorWithOwner({ name: 'A' });
      const b = await vendorWithOwner({ name: 'B' });
      // b.owner also staffs A; a token whose vendorId is A still carries VENDOR_OWNER (from B).
      await t.db.userRole.create({
        data: { id: ulid(), userId: b.owner.id, role: 'VENDOR_STAFF', vendorId: a.vendor.id },
      });
      const token = await t.signAccessToken(b.owner, ['VENDOR_OWNER', 'VENDOR_STAFF'], a.vendor.id);
      const res = await send(
        'POST',
        { authorization: `Bearer ${token}` },
        '/v1/vendor/zalo/login-requests',
      );
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().errorCode).toBe('common.error.forbidden');
      expect(await t.redis.llen(ZALO_LOGIN_QUEUE_KEY)).toBe(0);
    });

    it('re-checks the vendor status before writes (stale token of a suspended shop)', async () => {
      const { vendor, owner } = await vendorWithOwner();
      const token = await t.signAccessToken(owner, ['VENDOR_OWNER'], vendor.id);
      await t.db.vendor.update({ where: { id: vendor.id }, data: { status: 'SUSPENDED' } });
      const res = await send(
        'PUT',
        { authorization: `Bearer ${token}` },
        '/v1/vendor/zalo/templates/ORDER_PLACED',
        { isEnabled: true, body: 'Hi' },
      );
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().errorCode).toBe('vendor.error.suspended');
    });

    it('a vendor role without a vendorId claim is forbidden', async () => {
      const { owner } = await vendorWithOwner();
      const token = await t.signAccessToken(owner, ['VENDOR_OWNER']);
      const res = await get({ authorization: `Bearer ${token}` }, '/v1/vendor/zalo/account');
      expect(res.statusCode).toBe(403);
    });
  });

  describe('account + QR login', () => {
    it('returns null without an account, then the public fields only', async () => {
      const { vendor, headers } = await vendorWithOwner();
      expect((await get(headers, '/v1/vendor/zalo/account')).json()).toEqual({ account: null });
      await addAccount(vendor.id);
      const res = await get(headers, '/v1/vendor/zalo/account');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        account: {
          status: 'ACTIVE',
          displayName: 'Shop Zalo',
          avatarUrl: 'https://example.com/a.png',
          lastLoginAt: '2026-11-20T00:00:00.000Z',
          lastSeenAt: null,
        },
      });
    });

    it('queues a login request in Redis and serves its state to the same vendor only', async () => {
      const { vendor, owner, headers } = await vendorWithOwner();
      const res = await send('POST', headers, '/v1/vendor/zalo/login-requests');
      expect(res.statusCode).toBe(202);
      const { loginId } = res.json<{ loginId: string }>();

      expect(await t.redis.lrange(ZALO_LOGIN_QUEUE_KEY, 0, -1)).toEqual([loginId]);
      const raw = await t.redis.get(zaloLoginKey(loginId));
      expect(ZaloLoginRecordSchema.parse(JSON.parse(raw ?? 'null'))).toEqual({
        vendorId: vendor.id,
        requestedById: owner.id,
        state: { state: 'PENDING' },
      });
      const ttl = await t.redis.ttl(zaloLoginKey(loginId));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);

      const state = await get(headers, `/v1/vendor/zalo/login-requests/${loginId}`);
      expect(state.statusCode).toBe(200);
      expect(state.json()).toEqual({ state: 'PENDING' });

      // The worker overwrites the state.
      await t.redis.set(
        zaloLoginKey(loginId),
        JSON.stringify({
          vendorId: vendor.id,
          requestedById: owner.id,
          state: { state: 'QR_READY', qrImage: 'data:image/png;base64,AAAA' },
        }),
      );
      expect((await get(headers, `/v1/vendor/zalo/login-requests/${loginId}`)).json()).toEqual({
        state: 'QR_READY',
        qrImage: 'data:image/png;base64,AAAA',
      });

      // Same vendor, but requested by another user: the QR is a login capability → 404.
      await t.redis.set(
        zaloLoginKey(loginId),
        JSON.stringify({ vendorId: vendor.id, requestedById: ulid(), state: { state: 'PENDING' } }),
      );
      expect((await get(headers, `/v1/vendor/zalo/login-requests/${loginId}`)).statusCode).toBe(
        404,
      );
      await t.redis.set(
        zaloLoginKey(loginId),
        JSON.stringify({
          vendorId: vendor.id,
          requestedById: owner.id,
          state: { state: 'PENDING' },
        }),
      );

      const other = await vendorWithOwner({ name: 'Other' });
      const foreign = await get(other.headers, `/v1/vendor/zalo/login-requests/${loginId}`);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json<ErrorBody>().errorCode).toBe('zalo.error.login-not-found');

      expect((await get(headers, `/v1/vendor/zalo/login-requests/${ulid()}`)).statusCode).toBe(404);
      await t.redis.set(zaloLoginKey(loginId), 'not json');
      expect((await get(headers, `/v1/vendor/zalo/login-requests/${loginId}`)).statusCode).toBe(
        404,
      );
      expect((await get(headers, '/v1/vendor/zalo/login-requests/not-a-ulid')).statusCode).toBe(
        422,
      );
    });

    it('disconnect wipes the session; nothing connected → 404', async () => {
      const { vendor, headers } = await vendorWithOwner();
      const none = await send('POST', headers, '/v1/vendor/zalo/account/disconnect');
      expect(none.statusCode).toBe(404);
      expect(none.json<ErrorBody>().errorCode).toBe('zalo.error.account-not-connected');

      await addAccount(vendor.id, 'EXPIRED');
      const res = await send('POST', headers, '/v1/vendor/zalo/account/disconnect');
      expect(res.statusCode).toBe(200);
      expect(res.json<{ account: { status: string } }>().account.status).toBe('DISCONNECTED');
      const row = await t.db.zaloAccount.findUniqueOrThrow({ where: { vendorId: vendor.id } });
      expect(row).toMatchObject({ credentials: null, zaloUid: null, lastError: null });

      expect((await send('POST', headers, '/v1/vendor/zalo/account/disconnect')).statusCode).toBe(
        404,
      );
    });
  });

  describe('templates', () => {
    it('lists every event, disabled until configured', async () => {
      const { headers } = await vendorWithOwner();
      const res = await get(headers, '/v1/vendor/zalo/templates');
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: TemplateBody[]; placeholders: string[] }>();
      expect(body.items.map((i) => i.event)).toEqual([
        'ORDER_PLACED',
        'ORDER_PAID',
        'ORDER_PROCESSING',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
        'ORDER_COMPLETED',
        'ORDER_CANCELLED',
        'ORDER_REFUNDED',
        'AFTER_DELIVERY',
      ]);
      expect(body.items.every((i) => !i.isEnabled && i.body === null && i.updatedAt === null)).toBe(
        true,
      );
      expect(body.placeholders).toContain('customerName');
    });

    it('upserts, keeps the delay only for AFTER_DELIVERY, rejects unknown placeholders', async () => {
      const { vendor, headers } = await vendorWithOwner();
      const shipped = await send('PUT', headers, '/v1/vendor/zalo/templates/ORDER_SHIPPED', {
        isEnabled: true,
        body: '  Đơn {{orderCode}} đã gửi qua {{ carrier }}  ',
        delayMinutes: 30,
      });
      expect(shipped.statusCode).toBe(200);
      expect(shipped.json<TemplateBody>()).toMatchObject({
        event: 'ORDER_SHIPPED',
        isEnabled: true,
        body: 'Đơn {{orderCode}} đã gửi qua {{ carrier }}',
        delayMinutes: 0,
      });

      const care = await send('PUT', headers, '/v1/vendor/zalo/templates/AFTER_DELIVERY', {
        isEnabled: true,
        body: 'Cảm ơn {{customerName}}!',
        delayMinutes: 4320,
      });
      expect(care.json<TemplateBody>().delayMinutes).toBe(4320);

      const updated = await send('PUT', headers, '/v1/vendor/zalo/templates/ORDER_SHIPPED', {
        isEnabled: false,
        body: 'Off',
      });
      expect(updated.json<TemplateBody>()).toMatchObject({ isEnabled: false, body: 'Off' });
      expect(await t.db.zaloMessageTemplate.count({ where: { vendorId: vendor.id } })).toBe(2);

      const bad = await send('PUT', headers, '/v1/vendor/zalo/templates/ORDER_PLACED', {
        isEnabled: true,
        body: 'Hi {{customerName}} {{discountCode}}',
      });
      expect(bad.statusCode).toBe(422);
      expect(bad.json<ErrorBody>()).toEqual({
        errorCode: 'zalo.error.unknown-placeholder',
        params: { placeholder: 'discountCode' },
      });

      expect(
        (
          await send('PUT', headers, '/v1/vendor/zalo/templates/NOPE', {
            isEnabled: true,
            body: 'x',
          })
        ).statusCode,
      ).toBe(422);

      const list = (await get(headers, '/v1/vendor/zalo/templates')).json<{
        items: TemplateBody[];
      }>();
      expect(list.items.find((i) => i.event === 'AFTER_DELIVERY')).toMatchObject({
        isEnabled: true,
        delayMinutes: 4320,
      });
    });
  });

  // ─── checkout / cancel / status helper ───────────────────────────────────────────────────────

  async function shop(name: string) {
    const { vendor } = await makeVendor(t.db, { displayName: name });
    const product = await makeProduct(t.db, {
      vendorId: vendor.id,
      price: 100_000,
      variants: [{ stockOnHand: 10 }],
    });
    const method = await makeShippingMethod(t.db, { vendorId: vendor.id, price: 30_000 });
    const variant = product.variants[0];
    if (!variant) throw new Error('no variant');
    return { vendor, variant, method };
  }

  async function placeOrder(shops: Awaited<ReturnType<typeof shop>>[], zaloOptIn?: boolean) {
    const user = await makeUser(t.db);
    const address = await makeAddress(t.db, { userId: user.id, isDefault: true });
    const res = await send('POST', await t.authHeader(user), '/v1/orders/checkout', {
      items: shops.map((s) => ({ variantId: s.variant.id, quantity: 1 })),
      addressId: address.id,
      shippingMethodIds: shops.map((s) => s.method.id),
      provider: 'VNPAY',
      ...(zaloOptIn !== undefined && { zaloOptIn }),
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<{ id: string; subOrders: { id: string; vendorId: string }[] }>();
    return { user, order };
  }

  describe('message queue', () => {
    it('checkout queues ORDER_PLACED for opted-in orders of vendors with a usable account', async () => {
      const active = await shop('Active');
      const expired = await shop('Expired');
      const disconnected = await shop('Disconnected');
      const none = await shop('None');
      await addAccount(active.vendor.id, 'ACTIVE');
      await addAccount(expired.vendor.id, 'EXPIRED');
      await addAccount(disconnected.vendor.id, 'DISCONNECTED');

      const { order } = await placeOrder([active, expired, disconnected, none], true);
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).zaloOptIn).toBe(
        true,
      );
      const rows = await t.db.zaloMessage.findMany({ orderBy: { vendorId: 'asc' } });
      expect(rows.map((r) => [r.vendorId, r.event, r.status]).sort()).toEqual(
        [
          [active.vendor.id, 'ORDER_PLACED', 'PENDING'],
          [expired.vendor.id, 'ORDER_PLACED', 'PENDING'],
        ].sort(),
      );
      const subOrderOf = (vendorId: string) =>
        order.subOrders.find((s) => s.vendorId === vendorId)?.id;
      for (const row of rows) expect(row.subOrderId).toBe(subOrderOf(row.vendorId));
    });

    it('checkout without opt-in (default) queues nothing', async () => {
      const active = await shop('Active');
      await addAccount(active.vendor.id);
      const { order } = await placeOrder([active]);
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).zaloOptIn).toBe(
        false,
      );
      expect(await t.db.zaloMessage.count()).toBe(0);
    });

    it('cancel queues ORDER_CANCELLED', async () => {
      const active = await shop('Active');
      await addAccount(active.vendor.id);
      const { user, order } = await placeOrder([active], true);
      const res = await send('POST', await t.authHeader(user), `/v1/orders/${order.id}/cancel`);
      expect(res.statusCode).toBe(200);
      const events = await t.db.zaloMessage.findMany({ select: { event: true } });
      expect(events.map((e) => e.event).sort()).toEqual(['ORDER_CANCELLED', 'ORDER_PLACED']);
    });

    it('DELIVERED queues ORDER_DELIVERED + AFTER_DELIVERY at deliveredAt + template delay', async () => {
      const care = await shop('Care');
      const plain = await shop('Plain');
      await addAccount(care.vendor.id);
      await addAccount(plain.vendor.id);
      await t.db.zaloMessageTemplate.createMany({
        data: [
          {
            id: ulid(),
            vendorId: care.vendor.id,
            event: 'AFTER_DELIVERY',
            body: 'Cảm ơn!',
            isEnabled: true,
            delayMinutes: 60,
          },
          {
            id: ulid(),
            vendorId: plain.vendor.id,
            event: 'AFTER_DELIVERY',
            body: 'Off',
            isEnabled: false,
            delayMinutes: 60,
          },
        ],
      });
      const { order } = await placeOrder([care, plain], true);
      const deliveredAt = new Date('2026-11-23T10:00:00Z');
      const subOrderIds = order.subOrders.map((s) => s.id);
      await t.db.subOrder.updateMany({
        where: { id: { in: subOrderIds } },
        data: { status: 'DELIVERED', deliveredAt },
      });
      const now = new Date('2026-11-23T10:05:00Z');

      const created = await t.db.$transaction((tx) =>
        queueZaloStatusMessages(tx, subOrderIds, 'DELIVERED', now),
      );
      expect(created).toBe(3);
      const rows = await t.db.zaloMessage.findMany({
        where: { event: { in: ['ORDER_DELIVERED', 'AFTER_DELIVERY'] } },
      });
      const careRow = rows.find((r) => r.event === 'AFTER_DELIVERY');
      expect(careRow?.vendorId).toBe(care.vendor.id);
      expect(careRow?.scheduledAt.toISOString()).toBe('2026-11-23T11:00:00.000Z');
      expect(rows.filter((r) => r.event === 'ORDER_DELIVERED').map((r) => r.scheduledAt)).toEqual([
        now,
        now,
      ]);

      // Replays are no-ops; statuses without an event queue nothing.
      expect(
        await t.db.$transaction((tx) => queueZaloStatusMessages(tx, subOrderIds, 'DELIVERED', now)),
      ).toBe(0);
      expect(
        await t.db.$transaction((tx) =>
          queueZaloStatusMessages(tx, subOrderIds, 'AWAITING_PAYMENT', now),
        ),
      ).toBe(0);
    });
  });

  describe('message log', () => {
    it('pages newest first, filters by status, hides other vendors', async () => {
      const mine = await shop('Mine');
      const theirs = await shop('Theirs');
      await addAccount(mine.vendor.id);
      await addAccount(theirs.vendor.id);
      const orders = [];
      for (let i = 0; i < 3; i += 1) orders.push((await placeOrder([mine, theirs], true)).order);
      const sent = await t.db.zaloMessage.findFirstOrThrow({
        where: { vendorId: mine.vendor.id },
        orderBy: { id: 'asc' },
      });
      await t.db.zaloMessage.update({
        where: { id: sent.id },
        data: { status: 'SENT', sentAt: new Date(), renderedBody: 'Hi' },
      });

      const owner = await t.db.user.findFirstOrThrow({
        where: { roles: { some: { vendorId: mine.vendor.id, role: 'VENDOR_OWNER' } } },
      });
      const headers = await t.authHeader(owner);
      const first = (
        await get(headers, '/v1/vendor/zalo/messages?limit=2')
      ).json<MessagePageBody>();
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBe(first.items[1]?.id);
      const second = (
        await get(headers, `/v1/vendor/zalo/messages?limit=2&cursor=${first.nextCursor}`)
      ).json<MessagePageBody>();
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      const all = [...first.items, ...second.items];
      expect(all.map((m) => m.orderId)).toEqual(orders.map((o) => o.id).reverse());
      expect(all.every((m) => m.event === 'ORDER_PLACED')).toBe(true);

      const onlySent = (
        await get(headers, '/v1/vendor/zalo/messages?status=SENT')
      ).json<MessagePageBody>();
      expect(onlySent.items.map((m) => m.id)).toEqual([sent.id]);
      expect((await get(headers, '/v1/vendor/zalo/messages?status=NOPE')).statusCode).toBe(422);
    });
  });
});
