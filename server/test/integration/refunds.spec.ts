import type { SubOrderStatus } from '@repo/core';
import { monotonicFactory } from 'ulid';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../src/common/idempotency/idempotency.interceptor';
import {
  type TestApp,
  createTestApp,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

const ulid = monotonicFactory();

interface ErrorBody {
  errorCode: string;
  params: Record<string, unknown>;
}

interface RefundBody {
  id: string;
  subOrderId: string;
  paymentId: string;
  amount: { amount: number; currency: string };
  status: string;
  reason: string;
  requestedById: string;
}

interface SubSpec {
  status?: SubOrderStatus;
  /** Units bought (one variant per sub-order); the variant's on-hand is already reduced by it. */
  qty?: number;
  unitPrice?: number;
  shipping?: number;
  vendorDiscount?: number;
  platformDiscount?: number;
  payoutReleasedAt?: Date;
}

/** paid_i (D7) of a sub-order spec. */
const paidOf = (s: SubSpec): number =>
  (s.unitPrice ?? 100_000) * (s.qty ?? 2) +
  (s.shipping ?? 30_000) -
  (s.vendorDiscount ?? 0) -
  (s.platformDiscount ?? 0);

const INITIAL_STOCK = 10;

describe('platform refunds API (Testcontainers)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /**
   * A paid order written straight to the DB (independent of the webhook code): one vendor +
   * variant per sub-order, stock already committed (`on_hand -= qty`), a CONFIRMED payment of
   * Σ paid_i and one escrow-IN ledger group per sub-order (`CUSTOMER −paid`, `ESCROW +paid`).
   */
  async function paidOrder(
    subs: SubSpec[],
    options: { paymentStatus?: 'CONFIRMED' | 'PENDING' } = {},
  ) {
    const customer = await makeUser(t.db);
    const orderId = ulid();
    const built = [];
    for (const s of subs) {
      const qty = s.qty ?? 2;
      const { vendor } = await makeVendor(t.db);
      const product = await makeProduct(t.db, {
        vendorId: vendor.id,
        price: s.unitPrice ?? 100_000,
        variants: [{ stockOnHand: INITIAL_STOCK - qty }],
      });
      const method = await makeShippingMethod(t.db, { vendorId: vendor.id });
      const variant = product.variants[0];
      if (!variant) throw new Error('no variant');
      built.push({ spec: s, qty, vendor, variant, method, subOrderId: ulid(), paid: paidOf(s) });
    }
    const total = built.reduce((acc, b) => acc + b.paid, 0);
    const paymentStatus = options.paymentStatus ?? 'CONFIRMED';
    const statuses = built.map((b) => b.spec.status ?? 'PAID');

    await t.db.order.create({
      data: {
        id: orderId,
        customerId: customer.id,
        status: statuses.every((s) => s === 'AWAITING_PAYMENT') ? 'AWAITING_PAYMENT' : 'PAID',
        currency: 'VND',
        itemsTotalAmount: BigInt(
          built.reduce((a, b) => a + (b.spec.unitPrice ?? 100_000) * b.qty, 0),
        ),
        shippingTotalAmount: BigInt(built.reduce((a, b) => a + (b.spec.shipping ?? 30_000), 0)),
        discountTotalAmount: BigInt(
          built.reduce(
            (a, b) => a + (b.spec.vendorDiscount ?? 0) + (b.spec.platformDiscount ?? 0),
            0,
          ),
        ),
        grandTotalAmount: BigInt(total),
        idempotencyKey: ulid(),
      },
    });
    for (const b of built) {
      const unit = b.spec.unitPrice ?? 100_000;
      await t.db.subOrder.create({
        data: {
          id: b.subOrderId,
          orderId,
          vendorId: b.vendor.id,
          status: b.spec.status ?? 'PAID',
          subtotalAmount: BigInt(unit * b.qty),
          shippingAmount: BigInt(b.spec.shipping ?? 30_000),
          discountAmount: BigInt(b.spec.vendorDiscount ?? 0),
          platformDiscountAmount: BigInt(b.spec.platformDiscount ?? 0),
          commissionAmount: BigInt(Math.floor((unit * b.qty) / 10)),
          currency: 'VND',
          shippingMethodId: b.method.id,
          shippingAddress: { recipientName: 'A', city: 'HCM' },
          payoutReleasedAt: b.spec.payoutReleasedAt ?? null,
          items: {
            create: {
              id: ulid(),
              variantId: b.variant.id,
              productTitleSnapshot: 'Test Product',
              variantAttributesSnapshot: {},
              unitPriceAmount: BigInt(unit),
              quantity: b.qty,
              lineTotalAmount: BigInt(unit * b.qty),
              currency: 'VND',
            },
          },
        },
      });
    }
    const payment = await t.db.payment.create({
      data: {
        id: ulid(),
        orderId,
        provider: 'STRIPE',
        status: paymentStatus,
        amount: BigInt(total),
        currency: 'VND',
      },
    });
    if (paymentStatus === 'CONFIRMED') {
      for (const b of built) {
        const txnGroupId = ulid();
        await t.db.ledgerEntry.createMany({
          data: [
            { account: 'CUSTOMER' as const, amount: BigInt(-b.paid) },
            { account: 'PLATFORM_ESCROW' as const, amount: BigInt(b.paid) },
          ].map((e) => ({
            ...e,
            id: ulid(),
            txnGroupId,
            entryType: 'ESCROW_IN' as const,
            currency: 'VND' as const,
            orderId,
            subOrderId: b.subOrderId,
          })),
        });
      }
    }
    return { orderId, customer, payment, subs: built };
  }

  const admin = () => makeUser(t.db, { roles: ['PLATFORM_ADMIN'] });

  const refund = async (
    user: { id: string },
    subOrderId: string,
    key: string = ulid(),
    reason = 'Customer complaint',
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/platform/sub-orders/${subOrderId}/refund`,
      headers: { ...(await t.authHeader(user)), 'idempotency-key': key },
      payload: { reason },
    });

  const escrowBalance = async (orderId: string): Promise<bigint> => {
    const agg = await t.db.ledgerEntry.aggregate({
      where: { orderId, account: 'PLATFORM_ESCROW' },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0n;
  };

  const stockOf = async (variantId: string) =>
    (await t.db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockOnHand;

  it('refunds 1 of 2 sub-orders: PARTIALLY_REFUNDED, ledger zero-sum, escrow keeps the other paid', async () => {
    const order = await paidOrder([
      { vendorDiscount: 10_000, platformDiscount: 5_000 },
      { qty: 1, unitPrice: 50_000, shipping: 20_000 },
    ]);
    const [first, second] = order.subs;
    if (!first || !second) throw new Error('setup');
    const a = await admin();

    const res = await refund(a, first.subOrderId);
    expect(res.statusCode).toBe(201);
    const body = res.json<RefundBody>();
    expect(body).toMatchObject({
      subOrderId: first.subOrderId,
      paymentId: order.payment.id,
      amount: { amount: 215_000, currency: 'VND' },
      status: 'PENDING',
      reason: 'Customer complaint',
      requestedById: a.id,
    });

    const dbOrder = await t.db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(dbOrder.status).toBe('PARTIALLY_REFUNDED');
    const so = await t.db.subOrder.findUniqueOrThrow({ where: { id: first.subOrderId } });
    expect(so.status).toBe('REFUNDED');

    const refundEntries = await t.db.ledgerEntry.findMany({
      where: { subOrderId: first.subOrderId, entryType: 'REFUND' },
    });
    expect(refundEntries).toHaveLength(2);
    expect(new Set(refundEntries.map((e) => e.txnGroupId)).size).toBe(1);
    expect(refundEntries.reduce((acc, e) => acc + e.amount, 0n)).toBe(0n);
    expect(Object.fromEntries(refundEntries.map((e) => [e.account, e.amount]))).toEqual({
      PLATFORM_ESCROW: -215_000n,
      CUSTOMER: 215_000n,
    });
    expect(await escrowBalance(order.orderId)).toBe(BigInt(second.paid));

    const outbox = await t.db.outboxEvent.findMany({ where: { eventType: 'refund.requested' } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      aggregateType: 'order',
      aggregateId: order.orderId,
      payload: { refundId: body.id, orderId: order.orderId, subOrderId: first.subOrderId },
    });

    // PAID → stock comes back.
    expect(await stockOf(first.variant.id)).toBe(INITIAL_STOCK);
    expect(await stockOf(second.variant.id)).toBe(INITIAL_STOCK - 1);
  });

  it('refunding both sub-orders makes the order REFUNDED and empties escrow', async () => {
    const order = await paidOrder([{ status: 'PROCESSING' }, { status: 'DELIVERED' }]);
    const a = await admin();
    for (const s of order.subs) expect((await refund(a, s.subOrderId)).statusCode).toBe(201);

    const dbOrder = await t.db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(dbOrder.status).toBe('REFUNDED');
    expect(await escrowBalance(order.orderId)).toBe(0n);
    const all = await t.db.ledgerEntry.findMany({ where: { orderId: order.orderId } });
    expect(all.reduce((acc, e) => acc + e.amount, 0n)).toBe(0n);
    const refunds = await t.db.refund.findMany({ where: { paymentId: order.payment.id } });
    expect(refunds.reduce((acc, r) => acc + r.amount, 0n)).toBe(order.payment.amount);
  });

  it('returns stock only when the sub-order was not shipped yet', async () => {
    const order = await paidOrder([
      { status: 'PROCESSING' },
      { status: 'SHIPPED' },
      { status: 'DELIVERED' },
    ]);
    const a = await admin();
    for (const s of order.subs) expect((await refund(a, s.subOrderId)).statusCode).toBe(201);
    const [processing, shipped, delivered] = order.subs;
    if (!processing || !shipped || !delivered) throw new Error('setup');
    expect(await stockOf(processing.variant.id)).toBe(INITIAL_STOCK);
    expect(await stockOf(shipped.variant.id)).toBe(INITIAL_STOCK - 2);
    expect(await stockOf(delivered.variant.id)).toBe(INITIAL_STOCK - 2);
  });

  it('blocks a refund after the payout was released (and on COMPLETED)', async () => {
    const order = await paidOrder([
      { status: 'DELIVERED', payoutReleasedAt: new Date() },
      { status: 'COMPLETED' },
    ]);
    const a = await admin();
    for (const [s, reason] of [
      [order.subs[0], 'payout-released'],
      [order.subs[1], 'status'],
    ] as const) {
      if (!s) throw new Error('setup');
      const res = await refund(a, s.subOrderId);
      expect(res.statusCode).toBe(409);
      expect(res.json<ErrorBody>()).toMatchObject({
        errorCode: 'refund.error.not-refundable',
        params: { reason },
      });
    }
    expect(await t.db.refund.count()).toBe(0);
    expect(await t.db.ledgerEntry.count({ where: { entryType: 'REFUND' } })).toBe(0);
  });

  it('blocks a second refund (sequential, new idempotency key)', async () => {
    const order = await paidOrder([{}, {}]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    const a = await admin();
    expect((await refund(a, s.subOrderId)).statusCode).toBe(201);
    const again = await refund(a, s.subOrderId);
    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorBody>().errorCode).toBe('refund.error.not-refundable');
    expect(await t.db.refund.count()).toBe(1);
    expect(await t.db.ledgerEntry.count({ where: { entryType: 'REFUND' } })).toBe(2);
    expect(await stockOf(s.variant.id)).toBe(INITIAL_STOCK);
  });

  it('lets exactly one of two concurrent refunds win', async () => {
    const order = await paidOrder([{}, {}]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    const [a1, a2] = [await admin(), await admin()];
    const results = await Promise.all([refund(a1, s.subOrderId), refund(a2, s.subOrderId)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await t.db.refund.count()).toBe(1);
    expect(await t.db.ledgerEntry.count({ where: { entryType: 'REFUND' } })).toBe(2);
    expect(await t.db.outboxEvent.count({ where: { eventType: 'refund.requested' } })).toBe(1);
    expect(await stockOf(s.variant.id)).toBe(INITIAL_STOCK);
    expect(await escrowBalance(order.orderId)).toBe(BigInt(order.subs[1]?.paid ?? -1));
  });

  it('replays the same idempotency key without refunding twice', async () => {
    const order = await paidOrder([{}]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    const a = await admin();
    const key = ulid();
    const first = await refund(a, s.subOrderId, key);
    const second = await refund(a, s.subOrderId, key);
    expect(second.statusCode).toBe(201);
    expect(second.headers[IDEMPOTENT_REPLAYED_HEADER]).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(await t.db.refund.count()).toBe(1);
  });

  it('refuses AWAITING_PAYMENT and CANCELLED sub-orders, and orders without a CONFIRMED payment', async () => {
    const a = await admin();
    const unpaid = await paidOrder([{ status: 'AWAITING_PAYMENT' }], { paymentStatus: 'PENDING' });
    const cancelled = await paidOrder([{ status: 'CANCELLED' }], { paymentStatus: 'PENDING' });
    const noPayment = await paidOrder([{ status: 'PAID' }], { paymentStatus: 'PENDING' });
    for (const [order, reason] of [
      [unpaid, 'status'],
      [cancelled, 'status'],
      [noPayment, 'no-confirmed-payment'],
    ] as const) {
      const s = order.subs[0];
      if (!s) throw new Error('setup');
      const res = await refund(a, s.subOrderId);
      expect(res.statusCode).toBe(409);
      expect(res.json<ErrorBody>()).toMatchObject({
        errorCode: 'refund.error.not-refundable',
        params: { reason },
      });
    }
    expect(await t.db.refund.count()).toBe(0);
  });

  it('a 0 sub-order refund is SUCCEEDED at once, without ledger rows or provider call', async () => {
    const order = await paidOrder([
      { qty: 1, unitPrice: 50_000, shipping: 0, platformDiscount: 50_000 },
      {},
    ]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    const res = await refund(await admin(), s.subOrderId);
    expect(res.statusCode).toBe(201);
    expect(res.json<RefundBody>()).toMatchObject({
      amount: { amount: 0, currency: 'VND' },
      status: 'SUCCEEDED',
    });
    expect(await t.db.ledgerEntry.count({ where: { entryType: 'REFUND' } })).toBe(0);
    expect(await t.db.outboxEvent.count({ where: { eventType: 'refund.requested' } })).toBe(0);
    expect((await t.db.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe(
      'PARTIALLY_REFUNDED',
    );
    expect(await stockOf(s.variant.id)).toBe(INITIAL_STOCK);
  });

  it('authorisation: STAFF cannot refund (403) but can list; own order 403; unknown 404', async () => {
    const order = await paidOrder([{}]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    const staff = await makeUser(t.db, { roles: ['PLATFORM_STAFF'] });
    const customer = await makeUser(t.db);

    const byStaff = await refund(staff, s.subOrderId);
    expect(byStaff.statusCode).toBe(403);
    expect((await refund(customer, s.subOrderId)).statusCode).toBe(403);

    // An admin refunding their own purchase.
    await t.db.userRole.create({
      data: { id: ulid(), userId: order.customer.id, role: 'PLATFORM_ADMIN' },
    });
    const own = await refund(order.customer, s.subOrderId);
    expect(own.statusCode).toBe(403);
    expect(own.json<ErrorBody>().errorCode).toBe('common.error.forbidden');

    const unknown = await refund(await admin(), ulid());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ErrorBody>().errorCode).toBe('sub-order.error.not-found');
    expect(await t.db.refund.count()).toBe(0);

    const list = await t.app.inject({
      method: 'GET',
      url: '/v1/platform/refunds',
      headers: await t.authHeader(staff),
    });
    expect(list.statusCode).toBe(200);
    expect(
      (
        await t.app.inject({
          method: 'GET',
          url: '/v1/platform/refunds',
          headers: await t.authHeader(customer),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('lists refunds newest first with status filter and cursor', async () => {
    const order = await paidOrder([
      {},
      {},
      { qty: 1, unitPrice: 10_000, shipping: 0, platformDiscount: 10_000 },
    ]);
    const a = await admin();
    for (const s of order.subs) expect((await refund(a, s.subOrderId)).statusCode).toBe(201);
    const headers = await t.authHeader(a);
    const get = (qs: string) =>
      t.app.inject({ method: 'GET', url: `/v1/platform/refunds${qs}`, headers });

    const page1 = (await get('?limit=2')).json<{
      items: (RefundBody & { orderId: string; vendorId: string })[];
      nextCursor: string | null;
    }>();
    expect(page1.items.map((r) => r.subOrderId)).toEqual([
      order.subs[2]?.subOrderId,
      order.subs[1]?.subOrderId,
    ]);
    expect(page1.items[0]).toMatchObject({
      orderId: order.orderId,
      vendorId: order.subs[2]?.vendor.id,
    });
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await get(`?limit=2&cursor=${page1.nextCursor}`)).json<{
      items: RefundBody[];
      nextCursor: string | null;
    }>();
    expect(page2.items.map((r) => r.subOrderId)).toEqual([order.subs[0]?.subOrderId]);
    expect(page2.nextCursor).toBeNull();

    const pending = (await get('?status=PENDING')).json<{ items: RefundBody[] }>();
    expect(pending.items).toHaveLength(2);
    const succeeded = (await get('?status=SUCCEEDED')).json<{ items: RefundBody[] }>();
    expect(succeeded.items.map((r) => r.subOrderId)).toEqual([order.subs[2]?.subOrderId]);
  });

  it('refunds against the earliest CONFIRMED payment equal to the order total, not a duplicate', async () => {
    const order = await paidOrder([{}]);
    const s = order.subs[0];
    if (!s) throw new Error('setup');
    // A later duplicate payment (manual review keeps it CONFIRMED) of a different amount, and an
    // even later one of the same amount: neither is the sale payment.
    for (const [attemptNo, amount] of [
      [2, 50_000],
      [3, s.paid],
    ] as const) {
      await t.db.payment.create({
        data: {
          id: ulid(),
          orderId: order.orderId,
          attemptNo,
          provider: 'STRIPE',
          status: 'CONFIRMED',
          amount: BigInt(amount),
          currency: 'VND',
        },
      });
    }
    const res = await refund(await admin(), s.subOrderId);
    expect(res.statusCode).toBe(201);
    expect(res.json<RefundBody>().paymentId).toBe(order.payment.id);
  });

  describe('retry of a FAILED provider refund', () => {
    const retry = async (user: { id: string }, refundId: string, key: string = ulid()) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/platform/refunds/${refundId}/retry`,
        headers: { ...(await t.authHeader(user)), 'idempotency-key': key },
      });

    /** An admin refund of the first sub-order whose provider call then FAILED (as the worker does). */
    async function failedRefund() {
      const order = await paidOrder([{}, {}]);
      const s = order.subs[0];
      if (!s) throw new Error('setup');
      const a = await admin();
      const created = (await refund(a, s.subOrderId)).json<RefundBody>();
      await t.db.refund.update({ where: { id: created.id }, data: { status: 'FAILED' } });
      await t.db.outboxEvent.deleteMany();
      return { order, s, a, failed: created };
    }

    const refundLedgerCount = () => t.db.ledgerEntry.count({ where: { entryType: 'REFUND' } });

    it('creates a new PENDING refund + refund.requested, without touching the ledger', async () => {
      const { order, s, a, failed } = await failedRefund();
      const ledgerBefore = await refundLedgerCount();
      const escrowBefore = await escrowBalance(order.orderId);

      const res = await retry(a, failed.id);
      expect(res.statusCode).toBe(201);
      const body = res.json<RefundBody>();
      expect(body.id).not.toBe(failed.id);
      expect(body).toMatchObject({
        subOrderId: s.subOrderId,
        paymentId: failed.paymentId,
        amount: failed.amount,
        status: 'PENDING',
        requestedById: a.id,
      });
      expect(body.reason).toContain(failed.id);
      expect((await t.db.refund.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe(
        'FAILED',
      );

      const outbox = await t.db.outboxEvent.findMany({ where: { eventType: 'refund.requested' } });
      expect(outbox.map((e) => e.payload)).toEqual([
        { refundId: body.id, orderId: order.orderId, subOrderId: s.subOrderId },
      ]);
      expect(await refundLedgerCount()).toBe(ledgerBefore);
      expect(await escrowBalance(order.orderId)).toBe(escrowBefore);
      const sub = await t.db.subOrder.findUniqueOrThrow({ where: { id: s.subOrderId } });
      expect(sub.status).toBe('REFUNDED');
    });

    it('retries a late-payment refund of a CANCELLED order', async () => {
      const { order, a, failed } = await failedRefund();
      await t.db.subOrder.updateMany({
        where: { orderId: order.orderId },
        data: { status: 'CANCELLED' },
      });
      await t.db.order.update({ where: { id: order.orderId }, data: { status: 'CANCELLED' } });
      expect((await retry(a, failed.id)).statusCode).toBe(201);
    });

    it('refuses to retry a PENDING or SUCCEEDED refund, or one already retried', async () => {
      const { a, failed } = await failedRefund();
      const first = (await retry(a, failed.id)).json<RefundBody>();

      const again = await retry(a, failed.id);
      expect(again.statusCode).toBe(409);
      expect(again.json<ErrorBody>()).toEqual({
        errorCode: 'refund.error.not-refundable',
        params: { subOrderId: failed.subOrderId, reason: 'refund-exists' },
      });

      const pending = await retry(a, first.id);
      expect(pending.statusCode).toBe(409);
      expect(pending.json<ErrorBody>().params['reason']).toBe('refund-not-failed');

      await t.db.refund.update({ where: { id: first.id }, data: { status: 'SUCCEEDED' } });
      const succeeded = await retry(a, first.id);
      expect(succeeded.statusCode).toBe(409);
      expect(succeeded.json<ErrorBody>().params['reason']).toBe('refund-not-failed');
      expect(await t.db.refund.count()).toBe(2);
    });

    it('lets exactly one of two concurrent retries win', async () => {
      const { failed } = await failedRefund();
      const [a1, a2] = [await admin(), await admin()];
      const results = await Promise.all([retry(a1, failed.id), retry(a2, failed.id)]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(await t.db.refund.count({ where: { status: 'PENDING' } })).toBe(1);
      expect(await t.db.outboxEvent.count({ where: { eventType: 'refund.requested' } })).toBe(1);
    });

    it('authorisation: STAFF 403, own order 403, unknown 404', async () => {
      const { order, failed } = await failedRefund();
      const staff = await makeUser(t.db, { roles: ['PLATFORM_STAFF'] });
      expect((await retry(staff, failed.id)).statusCode).toBe(403);

      const customerAdmin = await t.db.userRole.create({
        data: { id: ulid(), userId: order.customer.id, role: 'PLATFORM_ADMIN' },
      });
      const self = await retry({ id: customerAdmin.userId }, failed.id);
      expect(self.statusCode).toBe(403);

      const unknown = await retry(await admin(), ulid());
      expect(unknown.statusCode).toBe(404);
      expect(await t.db.refund.count({ where: { status: 'PENDING' } })).toBe(0);
    });
  });
});
