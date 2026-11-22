import {
  LedgerEntryPageSchema,
  OrderSchema,
  type SubOrderStatus,
  VendorSubOrderPageSchema,
  VendorSubOrderSchema,
  VendorWalletSchema,
} from '@repo/core';
import { monotonicFactory } from 'ulid';
import {
  type TestApp,
  createTestApp,
  makePlatformSettings,
  makeProduct,
  makeUser,
  makeVendor,
} from '../support';
import type { Db } from '../support/test-app';

const ulid = monotonicFactory();

/** `xs[i]`, failing the test when it is missing (instead of a non-null assertion). */
function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no element ${i}`);
  return x;
}

interface ErrorBody {
  errorCode: string;
}

interface SubOrderSpec {
  vendorId: string;
  variantId: string;
  status: SubOrderStatus;
  /** Minor units. */
  subtotal?: number;
  shipping?: number;
  vendorDiscount?: number;
  platformDiscount?: number;
  commission?: number;
  currency?: 'VND' | 'USD';
  payoutReleasedAt?: Date | null;
}

const SNAPSHOT = {
  recipientName: 'Nguyễn Văn A',
  phone: '0901234567',
  line1: '1 Lê Lợi',
  line2: null,
  ward: 'Bến Nghé',
  district: 'Quận 1',
  city: 'Hồ Chí Minh',
  country: 'VN',
};

/**
 * Inserts an order straight into the DB (as if checkout + payment confirmation had run), so each
 * test controls the exact sub-order statuses and money columns.
 */
async function makeOrder(db: Db, customerId: string, subs: readonly SubOrderSpec[]) {
  const currency = subs[0]?.currency ?? 'VND';
  const orderId = ulid();
  await db.order.create({
    data: {
      id: orderId,
      customerId,
      status: 'PAID',
      currency,
      itemsTotalAmount: 0n,
      shippingTotalAmount: 0n,
      grandTotalAmount: 0n,
      idempotencyKey: ulid(),
    },
  });
  const subOrderIds: string[] = [];
  for (const spec of subs) {
    const id = ulid();
    subOrderIds.push(id);
    const subtotal = BigInt(spec.subtotal ?? 200_000);
    await db.subOrder.create({
      data: {
        id,
        orderId,
        vendorId: spec.vendorId,
        status: spec.status,
        subtotalAmount: subtotal,
        shippingAmount: BigInt(spec.shipping ?? 30_000),
        discountAmount: BigInt(spec.vendorDiscount ?? 0),
        platformDiscountAmount: BigInt(spec.platformDiscount ?? 0),
        commissionAmount: BigInt(spec.commission ?? 20_000),
        currency: spec.currency ?? currency,
        shippingAddress: SNAPSHOT,
        payoutReleasedAt: spec.payoutReleasedAt ?? null,
        items: {
          create: {
            id: ulid(),
            variantId: spec.variantId,
            productTitleSnapshot: 'Áo thun',
            variantAttributesSnapshot: { size: 'M' },
            unitPriceAmount: subtotal / 2n,
            quantity: 2,
            lineTotalAmount: subtotal,
            currency: spec.currency ?? currency,
          },
        },
      },
    });
  }
  return { orderId, subOrderIds };
}

describe('vendor fulfilment + wallet (Testcontainers)', () => {
  let t: TestApp;
  let vendorId: string;
  let variantId: string;
  let ownerHeaders: Record<string, string>;
  let staffHeaders: Record<string, string>;
  let otherVendorId: string;
  let otherVariantId: string;
  let otherHeaders: Record<string, string>;
  let customer: { id: string };
  let customerHeaders: Record<string, string>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db);
    const a = await makeVendor(t.db);
    vendorId = a.vendor.id;
    ownerHeaders = await t.authHeader(a.owner);
    variantId = nth((await makeProduct(t.db, { vendorId })).variants, 0).id;
    const staff = await makeUser(t.db, { roles: ['CUSTOMER', 'VENDOR_STAFF'], vendorId });
    staffHeaders = await t.authHeader(staff);
    const b = await makeVendor(t.db);
    otherVendorId = b.vendor.id;
    otherHeaders = await t.authHeader(b.owner);
    otherVariantId = nth((await makeProduct(t.db, { vendorId: otherVendorId })).variants, 0).id;
    customer = await makeUser(t.db);
    customerHeaders = await t.authHeader(customer);
  });

  const post = (url: string, headers: Record<string, string>, payload?: object) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'idempotency-key': ulid() },
      ...(payload && { payload }),
    });
  const get = (url: string, headers: Record<string, string>) =>
    t.app.inject({ method: 'GET', url, headers });

  const SHIP = { carrier: 'GHN', trackingNumber: 'GHN123456' };

  /** Calls the endpoint that targets `to` (vendor for PROCESSING/SHIPPED/DELIVERED, customer for COMPLETED). */
  function move(orderId: string, subOrderId: string, to: SubOrderStatus) {
    switch (to) {
      case 'PROCESSING':
        return post(`/v1/vendor/sub-orders/${subOrderId}/accept`, ownerHeaders);
      case 'SHIPPED':
        return post(`/v1/vendor/sub-orders/${subOrderId}/ship`, ownerHeaders, SHIP);
      case 'DELIVERED':
        return post(`/v1/vendor/sub-orders/${subOrderId}/deliver`, ownerHeaders);
      default:
        return post(
          `/v1/orders/${orderId}/sub-orders/${subOrderId}/confirm-received`,
          customerHeaders,
        );
    }
  }

  const statusOf = async (subOrderId: string) =>
    (await t.db.subOrder.findUniqueOrThrow({ where: { id: subOrderId } })).status;

  describe('transition matrix through the endpoints', () => {
    const FROM: SubOrderStatus[] = [
      'AWAITING_PAYMENT',
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'REFUNDED',
      'CANCELLED',
    ];
    const TARGETS: SubOrderStatus[] = ['PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
    const VALID = new Set([
      'PAID>PROCESSING',
      'PROCESSING>SHIPPED',
      'SHIPPED>DELIVERED',
      'SHIPPED>COMPLETED',
      'DELIVERED>COMPLETED',
    ]);
    const cases = FROM.flatMap((from) =>
      TARGETS.map((to): [SubOrderStatus, SubOrderStatus] => [from, to]),
    );

    it.each(cases)('%s → %s', async (from, to) => {
      const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: from },
      ]);
      const id = nth(subOrderIds, 0);
      const res = await move(orderId, id, to);
      if (VALID.has(`${from}>${to}`)) {
        expect(res.statusCode).toBe(200);
        expect(await statusOf(id)).toBe(to);
      } else {
        // Unpaid sub-orders are invisible to vendors (404); everything else is a 409.
        const hidden = to !== 'COMPLETED' && (from === 'AWAITING_PAYMENT' || from === 'CANCELLED');
        expect(res.statusCode).toBe(hidden ? 404 : 409);
        expect(res.json<ErrorBody>().errorCode).toBe(
          hidden ? 'sub-order.error.not-found' : 'order.error.invalid-status-transition',
        );
        expect(await statusOf(id)).toBe(from);
        expect(await t.db.outboxEvent.count()).toBe(0);
      }
    });
  });

  it('runs the happy path with timestamps, outbox events and the derived order status', async () => {
    const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
      { vendorId, variantId, status: 'PAID' },
    ]);
    const id = nth(subOrderIds, 0);

    const accepted = await move(orderId, id, 'PROCESSING');
    expect(accepted.statusCode).toBe(200);
    expect(VendorSubOrderSchema.parse(accepted.json()).status).toBe('PROCESSING');

    const shipped = VendorSubOrderSchema.parse((await move(orderId, id, 'SHIPPED')).json());
    expect(shipped).toMatchObject({
      status: 'SHIPPED',
      carrier: 'GHN',
      trackingNumber: 'GHN123456',
    });
    expect(shipped.shippedAt).not.toBeNull();

    const delivered = VendorSubOrderSchema.parse((await move(orderId, id, 'DELIVERED')).json());
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.completedAt).toBeNull();

    const confirmed = await move(orderId, id, 'COMPLETED');
    expect(confirmed.statusCode).toBe(200);
    const order = OrderSchema.parse(confirmed.json());
    expect(order.status).toBe('COMPLETED');
    expect(nth(order.subOrders, 0).completedAt).not.toBeNull();
    expect(nth(order.subOrders, 0).deliveredAt).toBe(delivered.deliveredAt);

    const events = await t.db.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((e) => [e.eventType, e.aggregateType, e.aggregateId])).toEqual([
      ['sub-order.shipped', 'order', orderId],
      ['sub-order.delivered', 'order', orderId],
      ['sub-order.completed', 'order', orderId],
    ]);
    expect(nth(events, 0).payload).toEqual({ orderId, subOrderId: id, customerId: customer.id });
    expect(nth(events, 1).payload).toEqual({ orderId, subOrderId: id, customerId: customer.id });
    expect(nth(events, 2).payload).toEqual({ orderId, subOrderId: id, vendorId });
  });

  it('confirm-received straight from SHIPPED also sets deliveredAt', async () => {
    const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
      { vendorId, variantId, status: 'SHIPPED' },
    ]);
    const res = await move(orderId, nth(subOrderIds, 0), 'COMPLETED');
    expect(res.statusCode).toBe(200);
    const row = await t.db.subOrder.findUniqueOrThrow({ where: { id: nth(subOrderIds, 0) } });
    expect(row.deliveredAt).not.toBeNull();
    expect(row.completedAt?.getTime()).toBe(row.deliveredAt?.getTime());
  });

  it('derives Order.status over two sub-orders in different states', async () => {
    const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
      { vendorId, variantId, status: 'SHIPPED' },
      { vendorId: otherVendorId, variantId: otherVariantId, status: 'PAID' },
    ]);
    const orderStatus = async () =>
      (await t.db.order.findUniqueOrThrow({ where: { id: orderId } })).status;

    expect((await move(orderId, nth(subOrderIds, 0), 'COMPLETED')).statusCode).toBe(200);
    expect(await orderStatus()).toBe('PAID'); // one COMPLETED, one still PAID

    const res = await post(`/v1/vendor/sub-orders/${nth(subOrderIds, 1)}/accept`, otherHeaders);
    expect(res.statusCode).toBe(200);
    expect(await orderStatus()).toBe('PAID');
  });

  it.each<[SubOrderStatus, string]>([
    ['COMPLETED', 'COMPLETED'],
    ['REFUNDED', 'PARTIALLY_REFUNDED'],
    ['SHIPPED', 'PAID'],
  ])('completing one sub-order next to a %s one → order %s', async (otherStatus, expected) => {
    const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
      { vendorId, variantId, status: 'DELIVERED' },
      { vendorId: otherVendorId, variantId: otherVariantId, status: otherStatus },
    ]);
    expect((await move(orderId, nth(subOrderIds, 0), 'COMPLETED')).statusCode).toBe(200);
    expect((await t.db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(expected);
  });

  it('two concurrent accepts: exactly one succeeds', async () => {
    const { subOrderIds } = await makeOrder(t.db, customer.id, [
      { vendorId, variantId, status: 'PAID' },
    ]);
    const url = `/v1/vendor/sub-orders/${nth(subOrderIds, 0)}/accept`;
    const results = await Promise.all([post(url, ownerHeaders), post(url, staffHeaders)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await statusOf(nth(subOrderIds, 0))).toBe('PROCESSING');
  });

  describe('vendor scope', () => {
    it("vendor B gets 404 on vendor A's sub-order (read and write)", async () => {
      const { subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'PAID' },
      ]);
      const id = nth(subOrderIds, 0);
      for (const res of [
        await get(`/v1/vendor/sub-orders/${id}`, otherHeaders),
        await post(`/v1/vendor/sub-orders/${id}/accept`, otherHeaders),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.json<ErrorBody>().errorCode).toBe('sub-order.error.not-found');
      }
      expect(await statusOf(id)).toBe('PAID');
      const list = VendorSubOrderPageSchema.parse(
        (await get('/v1/vendor/sub-orders', otherHeaders)).json(),
      );
      expect(list.items).toEqual([]);
    });

    it('a customer cannot call vendor endpoints; a vendor-less JWT is refused', async () => {
      expect((await get('/v1/vendor/sub-orders', customerHeaders)).statusCode).toBe(403);
      const user = await makeUser(t.db);
      const forged = {
        authorization: `Bearer ${await t.signAccessToken(user, ['VENDOR_OWNER'], vendorId)}`,
      };
      // Claims a vendor role the DB does not back → VendorMembershipGuard.
      expect((await get('/v1/vendor/sub-orders', forged)).statusCode).toBe(403);
    });

    it('a suspended vendor can read but not move sub-orders', async () => {
      const { subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'PAID' },
      ]);
      await t.db.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED' } });
      expect(
        (await get(`/v1/vendor/sub-orders/${nth(subOrderIds, 0)}`, ownerHeaders)).statusCode,
      ).toBe(200);
      const res = await post(`/v1/vendor/sub-orders/${nth(subOrderIds, 0)}/accept`, ownerHeaders);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().errorCode).toBe('vendor.error.suspended');
      expect(await statusOf(nth(subOrderIds, 0))).toBe('PAID');
    });

    it('ship validates the body', async () => {
      const { subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'PROCESSING' },
      ]);
      const res = await post(`/v1/vendor/sub-orders/${nth(subOrderIds, 0)}/ship`, ownerHeaders, {
        carrier: ' ',
        trackingNumber: 'X',
      });
      expect(res.statusCode).toBe(422);
      expect(await statusOf(nth(subOrderIds, 0))).toBe('PROCESSING');
    });
  });

  describe('vendor reads', () => {
    it('lists paid sub-orders newest first with status filter and cursor; detail has commission + net', async () => {
      await makeOrder(t.db, customer.id, [{ vendorId, variantId, status: 'AWAITING_PAYMENT' }]);
      await makeOrder(t.db, customer.id, [{ vendorId, variantId, status: 'CANCELLED' }]);
      const a = await makeOrder(t.db, customer.id, [{ vendorId, variantId, status: 'PAID' }]);
      const b = await makeOrder(t.db, customer.id, [{ vendorId, variantId, status: 'SHIPPED' }]);
      const c = await makeOrder(t.db, customer.id, [
        {
          vendorId,
          variantId,
          status: 'PAID',
          subtotal: 500_000,
          shipping: 30_000,
          vendorDiscount: 50_000,
          platformDiscount: 10_000,
          commission: 45_000,
        },
      ]);

      const page1 = VendorSubOrderPageSchema.parse(
        (await get('/v1/vendor/sub-orders?limit=2', ownerHeaders)).json(),
      );
      expect(page1.items.map((s) => s.id)).toEqual([c.subOrderIds[0], b.subOrderIds[0]]);
      const page2 = VendorSubOrderPageSchema.parse(
        (
          await get(`/v1/vendor/sub-orders?limit=2&cursor=${page1.nextCursor}`, ownerHeaders)
        ).json(),
      );
      expect(page2.items.map((s) => s.id)).toEqual([a.subOrderIds[0]]);
      expect(page2.nextCursor).toBeNull();

      const paid = VendorSubOrderPageSchema.parse(
        (await get('/v1/vendor/sub-orders?status=PAID', ownerHeaders)).json(),
      );
      expect(paid.items.map((s) => s.id)).toEqual([c.subOrderIds[0], a.subOrderIds[0]]);
      expect(
        (await get('/v1/vendor/sub-orders?status=AWAITING_PAYMENT', ownerHeaders)).statusCode,
      ).toBe(422);

      const detail = VendorSubOrderSchema.parse(
        (await get(`/v1/vendor/sub-orders/${nth(c.subOrderIds, 0)}`, staffHeaders)).json(),
      );
      expect(detail.commission).toEqual({ amount: 45_000, currency: 'VND' });
      // net = 500_000 + 30_000 − 50_000 − 45_000 (platform discount is platform-funded)
      expect(detail.net).toEqual({ amount: 435_000, currency: 'VND' });
      expect(detail.total).toEqual({ amount: 470_000, currency: 'VND' });
      expect(detail.shippingAddress).toMatchObject({
        recipientName: 'Nguyễn Văn A',
        phone: '0901234567',
      });
      expect(detail.items).toHaveLength(1);
    });

    it('an unpaid sub-order is 404 for its own vendor', async () => {
      const { subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'AWAITING_PAYMENT' },
      ]);
      expect(
        (await get(`/v1/vendor/sub-orders/${nth(subOrderIds, 0)}`, ownerHeaders)).statusCode,
      ).toBe(404);
    });
  });

  describe('customer confirm-received', () => {
    it("another user's order is 404 and nothing changes", async () => {
      const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'DELIVERED' },
      ]);
      const stranger = await makeUser(t.db);
      const res = await post(
        `/v1/orders/${orderId}/sub-orders/${nth(subOrderIds, 0)}/confirm-received`,
        await t.authHeader(stranger),
      );
      expect(res.statusCode).toBe(404);
      expect(res.json<ErrorBody>().errorCode).toBe('order.error.not-found');
      expect(await statusOf(nth(subOrderIds, 0))).toBe('DELIVERED');
    });

    it('a sub-order of another order is 404', async () => {
      const first = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'DELIVERED' },
      ]);
      const second = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'DELIVERED' },
      ]);
      const res = await post(
        `/v1/orders/${first.orderId}/sub-orders/${nth(second.subOrderIds, 0)}/confirm-received`,
        customerHeaders,
      );
      expect(res.statusCode).toBe(404);
      expect(res.json<ErrorBody>().errorCode).toBe('sub-order.error.not-found');
    });

    it('a vendor cannot confirm receipt', async () => {
      const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'DELIVERED' },
      ]);
      const res = await post(
        `/v1/orders/${orderId}/sub-orders/${nth(subOrderIds, 0)}/confirm-received`,
        ownerHeaders,
      );
      // The owner is also a CUSTOMER, but not of this order → 404.
      expect(res.statusCode).toBe(404);
      expect(await statusOf(nth(subOrderIds, 0))).toBe('DELIVERED');
    });

    it('confirming twice: the second is 409 (no second outbox event)', async () => {
      const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'DELIVERED' },
      ]);
      expect((await move(orderId, nth(subOrderIds, 0), 'COMPLETED')).statusCode).toBe(200);
      expect((await move(orderId, nth(subOrderIds, 0), 'COMPLETED')).statusCode).toBe(409);
      expect(await t.db.outboxEvent.count({ where: { eventType: 'sub-order.completed' } })).toBe(1);
    });
  });

  describe('wallet + ledger', () => {
    it('balance + pending net per currency over mixed states', async () => {
      await t.db.wallet.update({ where: { vendorId }, data: { balanceAmount: 1_000_000n } });
      const net = {
        subtotal: 200_000,
        shipping: 30_000,
        vendorDiscount: 10_000,
        commission: 20_000,
      };
      // counted: PAID, PROCESSING, SHIPPED, DELIVERED, COMPLETED (unreleased) — 200 000 net each
      for (const status of ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'] as const) {
        await makeOrder(t.db, customer.id, [
          { vendorId, variantId, status, ...net, platformDiscount: 5_000 },
        ]);
      }
      // not counted: unpaid, cancelled, refunded, already paid out, other vendor
      for (const status of ['AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as const) {
        await makeOrder(t.db, customer.id, [{ vendorId, variantId, status, ...net }]);
      }
      await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'COMPLETED', ...net, payoutReleasedAt: new Date() },
      ]);
      await makeOrder(t.db, customer.id, [
        { vendorId: otherVendorId, variantId: otherVariantId, status: 'PAID', ...net },
      ]);
      // a USD sub-order: 1 000 + 0 − 0 − 100 = 900 cents
      await makeOrder(t.db, customer.id, [
        {
          vendorId,
          variantId,
          status: 'SHIPPED',
          currency: 'USD',
          subtotal: 1_000,
          shipping: 0,
          commission: 100,
        },
      ]);

      const res = await get('/v1/vendor/wallet', ownerHeaders);
      expect(res.statusCode).toBe(200);
      const wallet = VendorWalletSchema.parse(res.json());
      expect(wallet.vendorId).toBe(vendorId);
      expect(wallet.balance).toEqual({ amount: 1_000_000, currency: 'VND' });
      expect(wallet.pending).toEqual([
        { amount: 900, currency: 'USD' },
        { amount: 1_000_000, currency: 'VND' },
      ]);
    });

    it('pending is empty with no paid sub-orders', async () => {
      const wallet = VendorWalletSchema.parse(
        (await get('/v1/vendor/wallet', ownerHeaders)).json(),
      );
      expect(wallet.pending).toEqual([]);
      expect(wallet.balance).toEqual({ amount: 0, currency: 'VND' });
    });

    it('staff cannot see the wallet or the ledger', async () => {
      for (const url of ['/v1/vendor/wallet', '/v1/vendor/ledger']) {
        const res = await get(url, staffHeaders);
        expect(res.statusCode).toBe(403);
      }
    });

    it("an owner of one vendor who is staff of another cannot read the other's wallet", async () => {
      const user = await makeUser(t.db);
      await makeVendor(t.db, { ownerId: user.id });
      await t.db.userRole.create({
        data: { id: ulid(), userId: user.id, role: 'VENDOR_STAFF', vendorId: otherVendorId },
      });
      const headers = {
        authorization: `Bearer ${await t.signAccessToken(user, ['CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF'], otherVendorId)}`,
      };
      const res = await get('/v1/vendor/wallet', headers);
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().errorCode).toBe('common.error.forbidden');
    });

    it('ledger lists only own VENDOR_WALLET lines, newest first, paginated', async () => {
      const { orderId, subOrderIds } = await makeOrder(t.db, customer.id, [
        { vendorId, variantId, status: 'COMPLETED' },
      ]);
      const other = await makeOrder(t.db, customer.id, [
        { vendorId: otherVendorId, variantId: otherVariantId, status: 'COMPLETED' },
      ]);
      const line = (
        account: 'VENDOR_WALLET' | 'PLATFORM_ESCROW' | 'PLATFORM_REVENUE',
        amount: bigint,
        v: string | null,
        o = orderId,
        s = nth(subOrderIds, 0),
      ) => ({
        id: ulid(),
        txnGroupId: ulid(),
        account,
        entryType: 'PAYOUT_OUT' as const,
        amount,
        currency: 'VND' as const,
        orderId: o,
        subOrderId: s,
        vendorId: v,
      });
      const first = line('VENDOR_WALLET', 190_000n, vendorId);
      const second = line('VENDOR_WALLET', 10_000n, vendorId);
      await t.db.ledgerEntry.createMany({
        data: [
          first,
          line('PLATFORM_ESCROW', -230_000n, vendorId),
          line('PLATFORM_REVENUE', 20_000n, null),
          line('VENDOR_WALLET', 999n, otherVendorId, other.orderId, nth(other.subOrderIds, 0)),
          second,
        ],
      });

      const page1 = LedgerEntryPageSchema.parse(
        (await get('/v1/vendor/ledger?limit=1', ownerHeaders)).json(),
      );
      expect(page1.items.map((e) => e.id)).toEqual([second.id]);
      const page2 = LedgerEntryPageSchema.parse(
        (await get(`/v1/vendor/ledger?limit=1&cursor=${page1.nextCursor}`, ownerHeaders)).json(),
      );
      expect(page2.items).toEqual([
        expect.objectContaining({
          id: first.id,
          account: 'VENDOR_WALLET',
          amount: { amount: 190_000, currency: 'VND' },
          orderId,
          subOrderId: subOrderIds[0],
        }),
      ]);
      expect(page2.nextCursor).toBeNull();
    });
  });
});
