import { buildSignData, hmacSha512 } from '@repo/payments';
import Stripe from 'stripe';
import { ulid } from 'ulid';
import {
  LATE_PAYMENT_REFUND_REASON,
  PaymentConfirmationService,
} from '../../src/payments/payment-confirmation.service';
import {
  type TestApp,
  createTestApp,
  makeAddress,
  makeCoupon,
  makePlatformSettings,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

interface OrderBody {
  id: string;
  status: string;
  grandTotal: { amount: number; currency: string };
  subOrders: { id: string; total: { amount: number; currency: string } }[];
}

const TMN = 'TESTTMN1';
const VNPAY_SECRET = 'test-vnpay-hash-secret';
const STRIPE_SECRET = 'whsec_test_secret';

/** Signed VNPay IPN / return query (amount in đồng; vnp_Amount = ×100). */
function vnpayQuery(
  paymentId: string,
  amount: number,
  options: { responseCode?: string; tmn?: string; secret?: string; txnNo?: string } = {},
): string {
  const code = options.responseCode ?? '00';
  const params: Record<string, string> = {
    vnp_TmnCode: options.tmn ?? TMN,
    vnp_TxnRef: paymentId,
    vnp_Amount: String(amount * 100),
    vnp_ResponseCode: code,
    vnp_TransactionStatus: code === '00' ? '00' : '02',
    vnp_TransactionNo: options.txnNo ?? '14000001',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261123100000',
    vnp_OrderInfo: 'Thanh toan don hang cua Nguyen Van A',
  };
  const data = buildSignData(params);
  return `${data}&vnp_SecureHash=${hmacSha512(options.secret ?? VNPAY_SECRET, data)}`;
}

function stripeEvent(
  type: string,
  paymentId: string,
  amount: number | null,
  options: { paymentStatus?: string; currency?: string } = {},
): string {
  return JSON.stringify({
    id: `evt_${ulid()}`,
    object: 'event',
    type,
    created: 1_795_000_000,
    data: {
      object: {
        id: `cs_test_${paymentId}`,
        object: 'checkout.session',
        client_reference_id: paymentId,
        metadata: { paymentId },
        payment_intent: `pi_${paymentId}`,
        payment_status: options.paymentStatus ?? 'paid',
        amount_total: amount,
        currency: options.currency ?? 'vnd',
        customer_details: { email: 'buyer@example.com', name: 'Nguyen Van A' },
      },
    },
  });
}

describe('payment webhooks + confirmation (Testcontainers)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db, { commissionBps: 1000, maxCouponStack: 3 });
  });

  async function customer(primaryLocale: 'VI' | 'EN' = 'VI') {
    const user = await makeUser(t.db, { primaryLocale });
    const address = await makeAddress(t.db, { userId: user.id, isDefault: true });
    return { user, address, headers: await t.authHeader(user) };
  }

  async function shop(price: number, stock: number, shipping: number) {
    const { vendor } = await makeVendor(t.db);
    const product = await makeProduct(t.db, {
      vendorId: vendor.id,
      price,
      variants: [{ stockOnHand: stock }],
    });
    const method = await makeShippingMethod(t.db, { vendorId: vendor.id, price: shipping });
    const variant = product.variants[0];
    if (!variant) throw new Error('no variant');
    return { vendor, variant, method };
  }

  /** Two-vendor order with a vendor coupon (shop A) and a platform coupon (both shops). */
  async function twoVendorOrder(provider: 'VNPAY' | 'STRIPE' = 'VNPAY', locale?: 'VI' | 'EN') {
    const buyer = await customer(locale);
    const a = await shop(100_000, 10, 30_000);
    const b = await shop(55_000, 10, 20_000);
    const vendorCoupon = await makeCoupon(t.db, {
      scope: 'VENDOR',
      vendorId: a.vendor.id,
      discountValue: 500,
    });
    const platformCoupon = await makeCoupon(t.db, { discountValue: 1000 });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/orders/checkout',
      headers: { ...buyer.headers, 'idempotency-key': ulid() },
      payload: {
        items: [
          { variantId: a.variant.id, quantity: 2 },
          { variantId: b.variant.id, quantity: 3 },
        ],
        addressId: buyer.address.id,
        shippingMethodIds: [a.method.id, b.method.id],
        couponCodes: [vendorCoupon.code, platformCoupon.code],
        provider,
      },
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderBody>();
    const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    return { order, payment, buyer, a, b };
  }

  const ipn = (query: string) =>
    t.app.inject({ method: 'GET', url: `/v1/payments/webhook/vnpay?${query}` });

  const stripe = (payload: string, signature?: string) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/payments/webhook/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature':
          signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_SECRET }),
      },
      payload,
    });

  const variantStock = async (id: string) => {
    const v = await t.db.productVariant.findUniqueOrThrow({ where: { id } });
    return { onHand: v.stockOnHand, reserved: v.stockReserved };
  };

  async function expectNoMoneyWrites(orderId: string) {
    expect(await t.db.ledgerEntry.count({ where: { orderId } })).toBe(0);
    expect(await t.db.refund.count()).toBe(0);
    expect(
      await t.db.outboxEvent.count({
        where: { aggregateId: orderId, eventType: { in: ['order.paid', 'refund.requested'] } },
      }),
    ).toBe(0);
  }

  /** Every ledger group of the order sums to 0; returns entries grouped by txn group. */
  async function ledgerGroups(orderId: string) {
    const entries = await t.db.ledgerEntry.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
    const groups = new Map<string, typeof entries>();
    for (const e of entries) groups.set(e.txnGroupId, [...(groups.get(e.txnGroupId) ?? []), e]);
    for (const group of groups.values()) {
      expect(group.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    }
    return [...groups.values()];
  }

  describe('VNPay IPN', () => {
    it('confirms a two-vendor order: payment, sub-orders, stock, ledger per D7, outbox', async () => {
      const { order, payment, a, b } = await twoVendorOrder();
      const res = await ipn(vnpayQuery(payment.id, order.grandTotal.amount));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ RspCode: '00', Message: 'Confirm Success' });

      const paid = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(paid.status).toBe('CONFIRMED');
      expect(paid.providerTxnId).toBe('14000001');
      // Minimal payload: no free-text order info.
      expect(paid.rawPayload).toMatchObject({ vnp_ResponseCode: '00', vnp_TxnRef: payment.id });
      expect(JSON.stringify(paid.rawPayload)).not.toContain('Nguyen');

      const dbOrder = await t.db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { subOrders: true },
      });
      expect(dbOrder.status).toBe('PAID');
      expect(dbOrder.subOrders.map((so) => so.status)).toEqual(['PAID', 'PAID']);

      expect(await variantStock(a.variant.id)).toEqual({ onHand: 8, reserved: 0 });
      expect(await variantStock(b.variant.id)).toEqual({ onHand: 7, reserved: 0 });

      const groups = await ledgerGroups(order.id);
      expect(groups).toHaveLength(2);
      for (const so of order.subOrders) {
        const group = groups.find((g) => g[0]?.subOrderId === so.id);
        expect(group?.map((e) => [e.account, e.entryType, Number(e.amount)])).toEqual(
          expect.arrayContaining([
            ['CUSTOMER', 'ESCROW_IN', -so.total.amount],
            ['PLATFORM_ESCROW', 'ESCROW_IN', so.total.amount],
          ]),
        );
      }
      // paid_i = subtotal + shipping − vendorDiscount − platformDiscount, Σ = grand total.
      const escrow = groups.flat().filter((e) => e.account === 'PLATFORM_ESCROW');
      expect(escrow.reduce((s, e) => s + e.amount, 0n)).toBe(BigInt(order.grandTotal.amount));
      for (const so of dbOrder.subOrders) {
        const expected =
          so.subtotalAmount + so.shippingAmount - so.discountAmount - so.platformDiscountAmount;
        expect(escrow.find((e) => e.subOrderId === so.id)?.amount).toBe(expected);
      }
      expect(dbOrder.subOrders.some((so) => so.platformDiscountAmount > 0n)).toBe(true);
      expect(dbOrder.subOrders.some((so) => so.discountAmount > 0n)).toBe(true);

      const events = await t.db.outboxEvent.findMany({
        where: { aggregateId: order.id, eventType: 'order.paid' },
      });
      expect(events.map((e) => e.payload)).toEqual([
        { orderId: order.id, customerId: dbOrder.customerId },
      ]);
    });

    it('a replayed IPN answers 02 and writes one ledger set', async () => {
      const { order, payment } = await twoVendorOrder();
      const query = vnpayQuery(payment.id, order.grandTotal.amount);
      expect((await ipn(query)).json()).toMatchObject({ RspCode: '00' });
      expect((await ipn(query)).json()).toEqual({
        RspCode: '02',
        Message: 'Order already confirmed',
      });
      expect(await t.db.ledgerEntry.count({ where: { orderId: order.id } })).toBe(4);
      expect(
        await t.db.outboxEvent.count({ where: { aggregateId: order.id, eventType: 'order.paid' } }),
      ).toBe(1);
    });

    it('bad signature → 97 and nothing written', async () => {
      const { order, payment, a } = await twoVendorOrder();
      const res = await ipn(vnpayQuery(payment.id, order.grandTotal.amount, { secret: 'wrong' }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ RspCode: '97', Message: 'Invalid signature' });
      // Tampered amount after signing.
      const tampered = vnpayQuery(payment.id, order.grandTotal.amount).replace(
        `vnp_Amount=${order.grandTotal.amount * 100}`,
        'vnp_Amount=100',
      );
      expect((await ipn(tampered)).json()).toMatchObject({ RspCode: '97' });
      // Foreign terminal (validly signed with our secret) is rejected too.
      expect(
        (await ipn(vnpayQuery(payment.id, order.grandTotal.amount, { tmn: 'OTHER' }))).json(),
      ).toMatchObject({ RspCode: '97' });

      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        'AWAITING_PAYMENT',
      );
      expect(await variantStock(a.variant.id)).toEqual({ onHand: 10, reserved: 2 });
      await expectNoMoneyWrites(order.id);
    });

    it('order of checks: unknown payment 01 → amount 04 (marks FAILED) → already processed', async () => {
      const { order, payment } = await twoVendorOrder();
      // Unknown payment wins over a wrong amount.
      expect((await ipn(vnpayQuery(ulid(), 1))).json()).toEqual({
        RspCode: '01',
        Message: 'Order not found',
      });

      const mismatch = await ipn(vnpayQuery(payment.id, order.grandTotal.amount - 1));
      expect(mismatch.json()).toEqual({ RspCode: '04', Message: 'invalid amount' });
      const failedRow = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      // FAILED, but the provider reference stays for a manual refund of the money it holds.
      expect(failedRow).toMatchObject({ status: 'FAILED', providerTxnId: '14000001' });
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        'AWAITING_PAYMENT',
      );
      await expectNoMoneyWrites(order.id);
      // Amount is checked before "already processed".
      expect((await ipn(vnpayQuery(payment.id, order.grandTotal.amount - 1))).json()).toMatchObject(
        { RspCode: '04' },
      );
    });

    it('a FAILED result fails the PENDING attempt only; the order keeps waiting', async () => {
      const { order, payment, a } = await twoVendorOrder();
      const failed = vnpayQuery(payment.id, order.grandTotal.amount, { responseCode: '24' });
      expect((await ipn(failed)).json()).toMatchObject({ RspCode: '00' });
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'FAILED',
      );
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        'AWAITING_PAYMENT',
      );
      expect(await variantStock(a.variant.id)).toEqual({ onHand: 10, reserved: 2 });
      expect((await ipn(failed)).json()).toMatchObject({ RspCode: '02' });
      await expectNoMoneyWrites(order.id);
    });

    it('money after cancellation → payment CONFIRMED + refund requested per sub-order', async () => {
      const { order, payment, buyer, a } = await twoVendorOrder();
      const cancel = await t.app.inject({
        method: 'POST',
        url: `/v1/orders/${order.id}/cancel`,
        headers: { ...buyer.headers, 'idempotency-key': ulid() },
      });
      expect(cancel.statusCode).toBe(200);

      const query = vnpayQuery(payment.id, order.grandTotal.amount);
      expect((await ipn(query)).json()).toMatchObject({ RspCode: '00' });

      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'CONFIRMED',
      );
      const dbOrder = await t.db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { subOrders: true },
      });
      expect(dbOrder.status).toBe('CANCELLED');
      expect(dbOrder.subOrders.every((so) => so.status === 'CANCELLED')).toBe(true);
      // Stock was released by the cancel and is not touched again.
      expect(await variantStock(a.variant.id)).toEqual({ onHand: 10, reserved: 0 });

      const refunds = await t.db.refund.findMany({ orderBy: { subOrderId: 'asc' } });
      expect(refunds).toHaveLength(2);
      for (const refund of refunds) {
        const so = order.subOrders.find((s) => s.id === refund.subOrderId);
        expect(refund).toMatchObject({
          status: 'PENDING',
          paymentId: payment.id,
          reason: LATE_PAYMENT_REFUND_REASON,
          requestedById: buyer.user.id,
          amount: BigInt(so?.total.amount ?? -1),
        });
      }

      const groups = await ledgerGroups(order.id);
      expect(groups).toHaveLength(4);
      const entries = groups.flat();
      expect(entries.filter((e) => e.entryType === 'ESCROW_IN')).toHaveLength(4);
      expect(entries.filter((e) => e.entryType === 'REFUND')).toHaveLength(4);
      const escrowNet = entries
        .filter((e) => e.account === 'PLATFORM_ESCROW')
        .reduce((s, e) => s + e.amount, 0n);
      expect(escrowNet).toBe(0n);

      const events = await t.db.outboxEvent.findMany({
        where: { aggregateId: order.id, eventType: 'refund.requested' },
        orderBy: { id: 'asc' },
      });
      expect(events.map((e) => e.payload)).toEqual(
        refunds.map((r) => ({ refundId: r.id, orderId: order.id, subOrderId: r.subOrderId })),
      );

      // Replay: no second refund set.
      expect((await ipn(query)).json()).toMatchObject({ RspCode: '02' });
      expect(await t.db.refund.count()).toBe(2);
      expect(await t.db.ledgerEntry.count({ where: { orderId: order.id } })).toBe(8);
    });

    it('an attempt superseded by a retry still pays the order; the second payment is held for manual refund', async () => {
      const { order, payment, buyer } = await twoVendorOrder();
      const total = order.grandTotal.amount;
      await ipn(vnpayQuery(payment.id, total, { responseCode: '24' }));
      const retry = await t.app.inject({
        method: 'POST',
        url: `/v1/orders/${order.id}/payments`,
        headers: { ...buyer.headers, 'idempotency-key': ulid() },
        payload: {},
      });
      expect(retry.statusCode).toBe(201);
      const second = await t.db.payment.findFirstOrThrow({
        where: { orderId: order.id, attemptNo: 2 },
      });

      // Late CONFIRMED for the FAILED first attempt.
      expect((await ipn(vnpayQuery(payment.id, total, { txnNo: '1' }))).json()).toMatchObject({
        RspCode: '00',
      });
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        'FAILED',
      );

      // Customer also paid the second attempt: recorded + escrowed, not applied, no refund row.
      expect((await ipn(vnpayQuery(second.id, total, { txnNo: '2' }))).json()).toMatchObject({
        RspCode: '00',
      });
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(
        'CONFIRMED',
      );
      const groups = await ledgerGroups(order.id);
      expect(groups).toHaveLength(3);
      const orderLevel = groups.find((g) => g[0]?.subOrderId === null);
      expect(orderLevel?.find((e) => e.account === 'PLATFORM_ESCROW')?.amount).toBe(BigInt(total));
      expect(await t.db.refund.count()).toBe(0);
      expect(
        await t.db.outboxEvent.count({ where: { aggregateId: order.id, eventType: 'order.paid' } }),
      ).toBe(1);
    });

    it('concurrent IPN and customer cancel end in one consistent state', async () => {
      for (let round = 0; round < 3; round += 1) {
        const { order, payment, buyer, a } = await twoVendorOrder();
        const [ipnRes, cancelRes] = await Promise.all([
          ipn(vnpayQuery(payment.id, order.grandTotal.amount)),
          t.app.inject({
            method: 'POST',
            url: `/v1/orders/${order.id}/cancel`,
            headers: { ...buyer.headers, 'idempotency-key': ulid() },
          }),
        ]);
        expect(ipnRes.json()).toMatchObject({ RspCode: '00' });
        const final = await t.db.order.findUniqueOrThrow({ where: { id: order.id } });
        const stock = await variantStock(a.variant.id);
        const refunds = await t.db.refund.count({ where: { paymentId: payment.id } });
        if (cancelRes.statusCode === 200) {
          expect(final.status).toBe('CANCELLED');
          expect(stock).toEqual({ onHand: 10, reserved: 0 });
          expect(refunds).toBe(2);
        } else {
          expect(cancelRes.statusCode).toBe(409);
          expect(final.status).toBe('PAID');
          expect(stock).toEqual({ onHand: 8, reserved: 0 });
          expect(refunds).toBe(0);
        }
        await ledgerGroups(order.id);
      }
    });
  });

  describe('Stripe webhook', () => {
    it('confirms on checkout.session.completed (raw body), replay is a no-op, PII is not stored', async () => {
      const { order, payment } = await twoVendorOrder('STRIPE');
      const payload = stripeEvent(
        'checkout.session.completed',
        payment.id,
        order.grandTotal.amount,
      );
      const res = await stripe(payload);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });

      const paid = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(paid.status).toBe('CONFIRMED');
      expect(paid.providerTxnId).toBe(`pi_${payment.id}`);
      expect(JSON.stringify(paid.rawPayload)).not.toMatch(/buyer@example\.com|Nguyen/);
      expect(paid.rawPayload).toMatchObject({ type: 'checkout.session.completed' });
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');

      expect((await stripe(payload)).statusCode).toBe(200);
      expect(await t.db.ledgerEntry.count({ where: { orderId: order.id } })).toBe(4);
    });

    it('bad signature → 400 signature-invalid, nothing written', async () => {
      const { order, payment } = await twoVendorOrder('STRIPE');
      const payload = stripeEvent(
        'checkout.session.completed',
        payment.id,
        order.grandTotal.amount,
      );
      const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
      const res = await stripe(payload, forged);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ errorCode: 'payment.error.signature-invalid' });
      // Signed bytes ≠ delivered bytes (re-serialised JSON) → rejected.
      const signed = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_SECRET });
      const reformatted = JSON.stringify(JSON.parse(payload), null, 2);
      expect((await stripe(reformatted, signed)).statusCode).toBe(400);
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );
      await expectNoMoneyWrites(order.id);
    });

    it('ignores unrelated events; expired session fails the attempt; amount mismatch → FAILED', async () => {
      const { order, payment } = await twoVendorOrder('STRIPE');
      const total = order.grandTotal.amount;
      expect((await stripe(stripeEvent('customer.created', payment.id, total))).statusCode).toBe(
        200,
      );
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );

      const mismatch = stripeEvent('checkout.session.completed', payment.id, total, {
        currency: 'usd',
      });
      expect((await stripe(mismatch)).statusCode).toBe(200);
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'FAILED',
      );
      await expectNoMoneyWrites(order.id);

      const other = await twoVendorOrder('STRIPE');
      const expired = stripeEvent('checkout.session.expired', other.payment.id, 0, {
        paymentStatus: 'unpaid',
      });
      // Expired session reports the session amount; a 0 here is a mismatch → still FAILED.
      expect((await stripe(expired)).statusCode).toBe(200);
      const expiredOk = stripeEvent(
        'checkout.session.expired',
        other.payment.id,
        other.order.grandTotal.amount,
        { paymentStatus: 'unpaid' },
      );
      expect((await stripe(expiredOk)).statusCode).toBe(200);
      expect(
        (await t.db.payment.findUniqueOrThrow({ where: { id: other.payment.id } })).status,
      ).toBe('FAILED');
      expect((await t.db.order.findUniqueOrThrow({ where: { id: other.order.id } })).status).toBe(
        'AWAITING_PAYMENT',
      );
    });

    it('acknowledges an authentic event with an unreadable amount (no retry storm, no writes)', async () => {
      const { order, payment } = await twoVendorOrder('STRIPE');
      const res = await stripe(
        stripeEvent('checkout.session.expired', payment.id, null, { paymentStatus: 'unpaid' }),
      );
      expect(res.statusCode).toBe(200);
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );
      await expectNoMoneyWrites(order.id);
    });

    it('JSON parsing elsewhere is unaffected; unknown routes still 404', async () => {
      const { order } = await twoVendorOrder();
      expect(order.subOrders).toHaveLength(2);
      const missing = await t.app.inject({
        method: 'POST',
        url: '/v1/payments/webhook/unknown',
        headers: { 'content-type': 'application/json' },
        payload: '{"a":1}',
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe('VNPay return route', () => {
    it('verifies, then redirects to the storefront without changing state', async () => {
      const { order, payment } = await twoVendorOrder('VNPAY', 'EN');
      const ok = await t.app.inject({
        method: 'GET',
        url: `/v1/payments/return/vnpay?${vnpayQuery(payment.id, order.grandTotal.amount)}`,
      });
      expect(ok.statusCode).toBe(302);
      expect(ok.headers.location).toBe(
        `http://localhost:3000/en/order/success?orderId=${order.id}`,
      );
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );
      await expectNoMoneyWrites(order.id);

      const failed = await t.app.inject({
        method: 'GET',
        url: `/v1/payments/return/vnpay?${vnpayQuery(payment.id, order.grandTotal.amount, { responseCode: '24' })}`,
      });
      expect(failed.headers.location).toBe(
        `http://localhost:3000/en/order/payment-failed?orderId=${order.id}`,
      );
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'PENDING',
      );

      const forged = await t.app.inject({
        method: 'GET',
        url: `/v1/payments/return/vnpay?${vnpayQuery(payment.id, 1, { secret: 'nope' })}`,
      });
      expect(forged.statusCode).toBe(302);
      expect(forged.headers.location).toBe(
        'http://localhost:3000/vi/order/payment-failed?error=payment.error.signature-invalid',
      );
    });
  });

  describe('zero-amount confirmation', () => {
    it('confirmZeroAmount pays a free order without ledger rows; refuses a non-zero payment', async () => {
      const buyer = await customer();
      const s = await shop(40_000, 5, 0);
      await makeCoupon(t.db, { code: 'FREE', discountValue: 10_000 });
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/orders/checkout',
        headers: { ...buyer.headers, 'idempotency-key': ulid() },
        payload: {
          items: [{ variantId: s.variant.id, quantity: 1 }],
          addressId: buyer.address.id,
          shippingMethodIds: [s.method.id],
          couponCodes: ['FREE'],
          provider: 'VNPAY',
        },
      });
      expect(res.statusCode).toBe(201);
      const order = res.json<OrderBody>();
      expect(order.grandTotal.amount).toBe(0);
      const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });

      const service = t.app.get(PaymentConfirmationService);
      await expect(service.confirmZeroAmount(payment.id)).resolves.toBe('confirmed');
      await expect(service.confirmZeroAmount(payment.id)).resolves.toBe('already-processed');
      const paid = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(paid).toMatchObject({ status: 'CONFIRMED', providerTxnId: payment.id });
      expect((await t.db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
      expect(await variantStock(s.variant.id)).toEqual({ onHand: 4, reserved: 0 });
      expect(await t.db.ledgerEntry.count()).toBe(0);

      const paidOrder = await twoVendorOrder();
      await expect(service.confirmZeroAmount(paidOrder.payment.id)).rejects.toMatchObject({
        code: 'payment.error.amount-mismatch',
      });
    });

    it('confirmZeroAmount on a cancelled free order writes nothing', async () => {
      const buyer = await customer();
      const s = await shop(40_000, 5, 0);
      const coupon = await makeCoupon(t.db, { discountValue: 10_000 });
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/orders/checkout',
        headers: { ...buyer.headers, 'idempotency-key': ulid() },
        payload: {
          items: [{ variantId: s.variant.id, quantity: 1 }],
          addressId: buyer.address.id,
          shippingMethodIds: [s.method.id],
          couponCodes: [coupon.code],
          provider: 'VNPAY',
        },
      });
      const order = res.json<OrderBody>();
      const cancel = await t.app.inject({
        method: 'POST',
        url: `/v1/orders/${order.id}/cancel`,
        headers: { ...buyer.headers, 'idempotency-key': ulid() },
      });
      expect(cancel.statusCode).toBe(200);
      const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
      const service = t.app.get(PaymentConfirmationService);
      await expect(service.confirmZeroAmount(payment.id)).resolves.toBe('already-processed');
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
        'FAILED',
      );
      await expectNoMoneyWrites(order.id);
    });
  });
});

describe('payment webhooks without provider config', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      env: { VNPAY_TMN_CODE: '', STRIPE_WEBHOOK_SECRET: '' },
    });
  });
  afterAll(() => t.close());

  it('boots and answers 503 payment.error.provider-unavailable', async () => {
    const stripeRes = await t.app.inject({
      method: 'POST',
      url: '/v1/payments/webhook/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(stripeRes.statusCode).toBe(503);
    expect(stripeRes.json()).toMatchObject({ errorCode: 'payment.error.provider-unavailable' });
    const vnpayRes = await t.app.inject({ method: 'GET', url: '/v1/payments/webhook/vnpay' });
    expect(vnpayRes.statusCode).toBe(503);
  });
});
