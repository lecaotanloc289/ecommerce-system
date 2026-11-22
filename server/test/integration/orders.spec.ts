import { CheckoutSchema, CouponSchema, Money, priceOrder, VendorIdSchema } from '@repo/core';
import { ulid } from 'ulid';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../src/common/idempotency/idempotency.interceptor';
import { CheckoutService } from '../../src/orders/checkout.service';
import { SESSION_CREATION_TIMEOUT_MS } from '../../src/orders/orders.service';
import {
  type TestApp,
  createTestApp,
  makeAddress,
  makeCategory,
  makeCoupon,
  makePlatformSettings,
  makeProduct,
  makeShippingMethod,
  makeUser,
  makeVendor,
} from '../support';

interface MoneyBody {
  amount: number;
  currency: string;
}

interface OrderBody {
  id: string;
  status: string;
  itemsTotal: MoneyBody;
  shippingTotal: MoneyBody;
  discountTotal: MoneyBody;
  grandTotal: MoneyBody;
  paymentDeadlineAt: string | null;
  subOrders: {
    id: string;
    vendorId: string;
    vendorName: string;
    status: string;
    subtotal: MoneyBody;
    shipping: MoneyBody;
    vendorDiscount: MoneyBody;
    platformDiscount: MoneyBody;
    total: MoneyBody;
    shippingMethodName: string | null;
    shippingAddress: { recipientName: string; city: string };
    cancelledAt: string | null;
    items: {
      variantId: string;
      productId: string;
      productTitle: string;
      quantity: number;
      unitPrice: MoneyBody;
      lineTotal: MoneyBody;
    }[];
  }[];
}

interface ErrorBody {
  errorCode: string;
  params: Record<string, unknown>;
}

const vnd = (amount: number): MoneyBody => ({ amount, currency: 'VND' });

describe('orders API (Testcontainers)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** A customer with a default address, ready to check out. */
  async function customer(options: { primaryLocale?: 'VI' | 'EN' } = {}) {
    const user = await makeUser(t.db, options);
    const address = await makeAddress(t.db, { userId: user.id, isDefault: true });
    return { user, address, headers: await t.authHeader(user) };
  }

  /** One ACTIVE vendor with one product (single variant) and one shipping method. */
  async function shop(
    options: {
      price?: number;
      stock?: number;
      shipping?: number;
      commissionBpsOverride?: number | null;
      categoryIds?: string[];
      name?: string;
    } = {},
  ) {
    const { vendor } = await makeVendor(t.db, {
      displayName: options.name ?? 'Shop',
      commissionBpsOverride: options.commissionBpsOverride ?? null,
    });
    const product = await makeProduct(t.db, {
      vendorId: vendor.id,
      price: options.price ?? 100_000,
      variants: [{ stockOnHand: options.stock ?? 10, attributes: { size: 'M' } }],
      categoryIds: options.categoryIds ?? [],
      name: options.name ? `${options.name} product` : 'Test Product',
    });
    const method = await makeShippingMethod(t.db, {
      vendorId: vendor.id,
      price: options.shipping ?? 30_000,
      name: 'Standard',
    });
    const variant = product.variants[0];
    if (!variant) throw new Error('no variant');
    return { vendor, product, variant, method };
  }

  const checkout = (headers: Record<string, string>, payload: object, key: string = ulid()) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/orders/checkout',
      headers: { ...headers, 'idempotency-key': key },
      payload,
    });

  const post = (headers: Record<string, string>, url: string, payload?: object) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: { ...headers, 'idempotency-key': ulid() },
      ...(payload && { payload }),
    });

  const get = (headers: Record<string, string>, url: string) =>
    t.app.inject({ method: 'GET', url, headers });

  const reserved = async (variantId: string) =>
    (await t.db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockReserved;

  beforeEach(async () => {
    await t.reset();
    await makePlatformSettings(t.db, { commissionBps: 1000, maxCouponStack: 3 });
  });

  it('requires a signed-in CUSTOMER', async () => {
    const anon = await t.app.inject({ method: 'GET', url: '/v1/orders' });
    expect(anon.statusCode).toBe(401);
    const { vendor } = await makeVendor(t.db);
    const staff = await makeUser(t.db, { roles: ['VENDOR_STAFF'], vendorId: vendor.id });
    expect((await get(await t.authHeader(staff), '/v1/orders')).statusCode).toBe(403);
  });

  it('checks out a single-vendor cart: order, reservation, payment, outbox, cart cleanup', async () => {
    const { user, address, headers } = await customer({ primaryLocale: 'EN' });
    const { vendor, product, variant, method } = await shop({ price: 100_000, stock: 5 });
    const other = await shop({ name: 'Other' });
    await t.db.cart.create({
      data: {
        id: ulid(),
        userId: user.id,
        items: {
          create: [
            { id: ulid(), variantId: variant.id, quantity: 4 },
            { id: ulid(), variantId: other.variant.id, quantity: 1 },
          ],
        },
      },
    });

    const before = Date.now();
    const key = ulid();
    const res = await checkout(
      headers,
      {
        items: [{ variantId: variant.id, quantity: 2 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      },
      key,
    );
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderBody>();
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.itemsTotal).toEqual(vnd(200_000));
    expect(order.shippingTotal).toEqual(vnd(30_000));
    expect(order.discountTotal).toEqual(vnd(0));
    expect(order.grandTotal).toEqual(vnd(230_000));
    const deadline = Date.parse(order.paymentDeadlineAt ?? '');
    expect(deadline).toBeGreaterThanOrEqual(before + 30 * 60_000 - 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);

    expect(order.subOrders).toHaveLength(1);
    const [so] = order.subOrders;
    expect(so).toMatchObject({
      vendorId: vendor.id,
      vendorName: 'Shop',
      status: 'AWAITING_PAYMENT',
      subtotal: vnd(200_000),
      shipping: vnd(30_000),
      total: vnd(230_000),
      shippingMethodName: 'Standard',
      shippingAddress: { recipientName: address.recipientName, city: address.city },
    });
    expect(so?.items).toEqual([
      expect.objectContaining({
        variantId: variant.id,
        productId: product.id,
        productTitle: 'Test Product', // user's primaryLocale EN (vi is "Test Product (vi)")
        quantity: 2,
        unitPrice: vnd(100_000),
        lineTotal: vnd(200_000),
        attributes: { size: 'M' },
      }),
    ]);

    // D4 reservation; D5 commission snapshot (platform 10% of 200 000).
    expect(await reserved(variant.id)).toBe(2);
    const dbSub = await t.db.subOrder.findFirstOrThrow({ where: { orderId: order.id } });
    expect(dbSub.commissionAmount).toBe(20_000n);
    expect(dbSub.shippingMethodId).toBe(method.id);

    const dbOrder = await t.db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(dbOrder.customerId).toBe(user.id);
    expect(dbOrder.idempotencyKey).toBe(key);

    const payments = await t.db.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toEqual([
      expect.objectContaining({
        status: 'PENDING',
        attemptNo: 1,
        provider: 'VNPAY',
        amount: 230_000n,
        currency: 'VND',
        redirectUrl: null,
      }),
    ]);

    const events = await t.db.outboxEvent.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((e) => e.eventType)).toEqual(['order.created', 'payment.requested']);
    expect(events.every((e) => e.aggregateType === 'order' && e.aggregateId === order.id)).toBe(
      true,
    );
    expect(events[0]?.payload).toEqual({ orderId: order.id, customerId: user.id });
    expect(events[1]?.payload).toEqual({
      orderId: order.id,
      paymentId: payments[0]?.id,
      provider: 'VNPAY',
      attemptNo: 1,
    });

    // D3: no ledger at checkout.
    expect(await t.db.ledgerEntry.count()).toBe(0);

    // Purchased variant left the cart; the other line stays.
    const cartItems = await t.db.cartItem.findMany({ where: { cart: { userId: user.id } } });
    expect(cartItems.map((i) => i.variantId)).toEqual([other.variant.id]);
  });

  it('splits a two-vendor cart into two sub-orders with exact money (D5-D8)', async () => {
    const { user, address, headers } = await customer();
    const category = await makeCategory(t.db, { commissionBpsOverride: 800 });
    const a = await shop({
      name: 'Shop A',
      price: 100_000,
      shipping: 30_000,
      categoryIds: [category.id],
    });
    const b = await shop({
      name: 'Shop B',
      price: 50_000,
      shipping: 25_000,
      commissionBpsOverride: 1500,
    });
    await makeCoupon(t.db, {
      scope: 'VENDOR',
      vendorId: a.vendor.id,
      code: 'SHOPA10',
      discountType: 'PERCENT',
      discountValue: 1000,
    });
    const platform = await makeCoupon(t.db, {
      code: 'PLAT30K',
      discountType: 'FIXED',
      discountValue: 30_000,
    });

    const res = await checkout(headers, {
      items: [
        { variantId: a.variant.id, quantity: 2 },
        { variantId: b.variant.id, quantity: 1 },
      ],
      addressId: address.id,
      shippingMethodIds: [b.method.id, a.method.id],
      couponCodes: ['SHOPA10', 'PLAT30K'],
      provider: 'STRIPE',
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderBody>();

    // Hand-computed: A vendor coupon 10% of 200 000 = 20 000; platform 30 000 split 180 000 : 50 000
    // by largest remainder → 23 478 / 6 522; commission A 8% (category) of 180 000 = 14 400,
    // B 15% (vendor override) of 50 000 = 7 500.
    const soA = order.subOrders.find((s) => s.vendorId === a.vendor.id);
    const soB = order.subOrders.find((s) => s.vendorId === b.vendor.id);
    expect(soA).toMatchObject({
      subtotal: vnd(200_000),
      shipping: vnd(30_000),
      vendorDiscount: vnd(20_000),
      platformDiscount: vnd(23_478),
      total: vnd(186_522),
    });
    expect(soB).toMatchObject({
      subtotal: vnd(50_000),
      shipping: vnd(25_000),
      vendorDiscount: vnd(0),
      platformDiscount: vnd(6_522),
      total: vnd(68_478),
    });
    expect(order.itemsTotal).toEqual(vnd(250_000));
    expect(order.shippingTotal).toEqual(vnd(55_000));
    expect(order.discountTotal).toEqual(vnd(50_000));
    expect(order.grandTotal).toEqual(vnd(255_000));

    // Same numbers as the pricing engine itself.
    const couponShape = {
      redemptionCount: 0,
      minSpend: null,
      maxRedemptions: null,
      perUserLimit: null,
      isActive: true,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const engine = priceOrder({
      currency: 'VND',
      subOrders: [
        {
          vendorId: VendorIdSchema.parse(a.vendor.id),
          shipping: Money.of(30_000, 'VND'),
          lines: [{ unitPrice: Money.of(100_000, 'VND'), qty: 2, commissionBps: 800 }],
        },
        {
          vendorId: VendorIdSchema.parse(b.vendor.id),
          shipping: Money.of(25_000, 'VND'),
          lines: [{ unitPrice: Money.of(50_000, 'VND'), qty: 1, commissionBps: 1500 }],
        },
      ],
      vendorCoupons: [
        {
          coupon: CouponSchema.parse({
            ...couponShape,
            id: ulid(),
            scope: 'VENDOR',
            vendorId: a.vendor.id,
            code: 'SHOPA10',
            discountType: 'PERCENT',
            discountBps: 1000,
          }),
          totalRedemptions: 0,
          userRedemptions: 0,
        },
      ],
      platformCoupons: [
        {
          coupon: CouponSchema.parse({
            ...couponShape,
            id: platform.id,
            scope: 'PLATFORM',
            vendorId: null,
            code: 'PLAT30K',
            discountType: 'FIXED',
            discount: { amount: 30_000, currency: 'VND' },
          }),
          totalRedemptions: 0,
          userRedemptions: 0,
        },
      ],
      maxCouponStack: 3,
      now: new Date(),
    });
    expect([soA?.total.amount, soB?.total.amount]).toEqual(
      engine.subOrders.map((s) => s.paid.amount),
    );
    expect(engine.subOrders.map((s) => s.commission.amount)).toEqual([14_400, 7_500]);
    expect(order.grandTotal.amount).toBe(engine.grandTotal.amount);

    const subs = await t.db.subOrder.findMany({ where: { orderId: order.id } });
    const dbA = subs.find((s) => s.vendorId === a.vendor.id);
    const dbB = subs.find((s) => s.vendorId === b.vendor.id);
    expect(dbA).toMatchObject({
      discountAmount: 20_000n,
      platformDiscountAmount: 23_478n,
      commissionAmount: 14_400n,
      shippingMethodId: a.method.id,
    });
    expect(dbB).toMatchObject({
      discountAmount: 0n,
      platformDiscountAmount: 6_522n,
      commissionAmount: 7_500n,
      shippingMethodId: b.method.id,
    });

    const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.amount).toBe(255_000n);
    expect(payment.provider).toBe('STRIPE');

    const redemptions = await t.db.couponRedemption.findMany({ where: { orderId: order.id } });
    expect(redemptions).toHaveLength(2);
    expect(redemptions.find((r) => r.couponId === platform.id)).toMatchObject({
      userId: user.id,
      subOrderId: null,
      discountAmount: 30_000n,
    });
    expect(redemptions.find((r) => r.couponId !== platform.id)).toMatchObject({
      subOrderId: dbA?.id,
      discountAmount: 20_000n,
    });
  });

  it('rolls everything back when one line is out of stock (no partial reservation)', async () => {
    const { user, address, headers } = await customer();
    // Created first → smaller id → reserved first, then the second line fails.
    const ok = await shop({ stock: 5 });
    const short = await shop({ stock: 1 });
    await makeCoupon(t.db, { code: 'TENOFF' });
    await t.db.cart.create({
      data: {
        id: ulid(),
        userId: user.id,
        items: { create: { id: ulid(), variantId: ok.variant.id, quantity: 1 } },
      },
    });

    const res = await checkout(headers, {
      items: [
        { variantId: ok.variant.id, quantity: 1 },
        { variantId: short.variant.id, quantity: 2 },
      ],
      addressId: address.id,
      shippingMethodIds: [ok.method.id, short.method.id],
      couponCodes: ['TENOFF'],
      provider: 'VNPAY',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>()).toEqual({
      errorCode: 'checkout.error.out-of-stock',
      params: { variantId: short.variant.id },
    });
    expect(await reserved(ok.variant.id)).toBe(0);
    expect(await reserved(short.variant.id)).toBe(0);
    expect(await t.db.order.count()).toBe(0);
    expect(await t.db.subOrder.count()).toBe(0);
    expect(await t.db.payment.count()).toBe(0);
    expect(await t.db.couponRedemption.count()).toBe(0);
    expect(await t.db.outboxEvent.count()).toBe(0);
    expect(await t.db.cartItem.count()).toBe(1);
  });

  it('lets exactly one of two concurrent checkouts take the last unit', async () => {
    const { variant, method } = await shop({ stock: 1 });
    const buyers = await Promise.all([customer(), customer()]);
    const results = await Promise.all(
      buyers.map(({ address, headers }) =>
        checkout(headers, {
          items: [{ variantId: variant.id, quantity: 1 }],
          addressId: address.id,
          shippingMethodIds: [method.id],
          provider: 'VNPAY',
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.statusCode === 409);
    expect(loser?.json<ErrorBody>().errorCode).toBe('checkout.error.out-of-stock');
    expect(await reserved(variant.id)).toBe(1);
    expect(await t.db.order.count()).toBe(1);
    expect(await t.db.payment.count()).toBe(1);
  });

  it('replays the same order for the same key; a different body is 422 (Redis and DB backstop)', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop({ stock: 10 });
    const body = {
      items: [{ variantId: variant.id, quantity: 1 }],
      addressId: address.id,
      shippingMethodIds: [method.id],
      provider: 'VNPAY',
    };
    const key = ulid();

    const first = await checkout(headers, body, key);
    expect(first.statusCode).toBe(201);
    const replay = await checkout(headers, body, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers[IDEMPOTENT_REPLAYED_HEADER]).toBe('true');
    expect(replay.json<OrderBody>().id).toBe(first.json<OrderBody>().id);

    const changed = await checkout(
      headers,
      { ...body, items: [{ ...body.items[0], quantity: 2 }] },
      key,
    );
    expect(changed.statusCode).toBe(422);
    expect(changed.json<ErrorBody>().errorCode).toBe('idempotency.error.key-reused');

    // Redis record gone (expired / lost): the unique Order.idempotencyKey still answers.
    await t.redis.flushdb();
    const dbReplay = await checkout(headers, body, key);
    expect(dbReplay.statusCode).toBe(201);
    expect(dbReplay.json<OrderBody>().id).toBe(first.json<OrderBody>().id);
    await t.redis.flushdb();
    const dbChanged = await checkout(headers, { ...body, provider: 'STRIPE' }, key);
    expect(dbChanged.statusCode).toBe(422);
    expect(dbChanged.json<ErrorBody>().errorCode).toBe('idempotency.error.key-reused');

    // Another user presenting the same key never sees this order.
    const intruder = await customer();
    const stolen = await checkout(
      intruder.headers,
      { ...body, addressId: intruder.address.id },
      key,
    );
    expect(stolen.statusCode).toBe(422);

    expect(await t.db.order.count()).toBe(1);
    expect(await reserved(variant.id)).toBe(1);
  });

  it('DB backstop: concurrent same-key checkouts (no Redis in the way) yield one order', async () => {
    const { user, address } = await customer();
    const { variant, method } = await shop({ stock: 1 });
    const service = t.app.get(CheckoutService);
    const input = CheckoutSchema.parse({
      items: [{ variantId: variant.id, quantity: 1 }],
      addressId: address.id,
      shippingMethodIds: [method.id],
      provider: 'VNPAY',
    });
    const key = ulid();
    // The loser fails on the last unit (or on the unique key) and must answer with the winner.
    const ids = await Promise.all([
      service.checkout(user.id, input, key),
      service.checkout(user.id, input, key),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(await t.db.order.count()).toBe(1);
    expect(await reserved(variant.id)).toBe(1);
  });

  it('enforces the coupon limit under concurrent checkouts', async () => {
    const { variant, method } = await shop({ stock: 10 });
    await makeCoupon(t.db, { code: 'RACE', maxRedemptions: 1 });
    const buyers = await Promise.all([customer(), customer(), customer()]);
    const results = await Promise.all(
      buyers.map(({ address, headers }) =>
        checkout(headers, {
          items: [{ variantId: variant.id, quantity: 1 }],
          addressId: address.id,
          shippingMethodIds: [method.id],
          couponCodes: ['RACE'],
          provider: 'VNPAY',
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422, 422]);
    expect(await t.db.couponRedemption.count()).toBe(1);
    expect(await reserved(variant.id)).toBe(1);
  });

  it('rejects a payment provider that cannot charge the order currency', async () => {
    const { address, headers } = await customer();
    const { vendor } = await makeVendor(t.db, { currency: 'USD' });
    const product = await makeProduct(t.db, { vendorId: vendor.id, currency: 'USD', price: 2_500 });
    const method = await makeShippingMethod(t.db, {
      vendorId: vendor.id,
      currency: 'USD',
      price: 500,
    });
    const body = {
      items: [{ variantId: product.variants[0]?.id, quantity: 1 }],
      addressId: address.id,
      shippingMethodIds: [method.id],
    };

    const vnpay = await checkout(headers, { ...body, provider: 'VNPAY' });
    expect(vnpay.statusCode).toBe(422);
    expect(vnpay.json<ErrorBody>()).toEqual({
      errorCode: 'payment.error.provider-currency-unsupported',
      params: { provider: 'VNPAY', currency: 'USD' },
    });
    expect(await t.db.order.count()).toBe(0);

    const stripe = await checkout(headers, { ...body, provider: 'STRIPE' });
    expect(stripe.statusCode).toBe(201);
    const order = stripe.json<OrderBody>();
    expect(order.grandTotal).toEqual({ amount: 3_000, currency: 'USD' });

    await t.db.payment.updateMany({ where: { orderId: order.id }, data: { status: 'FAILED' } });
    const retry = await post(headers, `/v1/orders/${order.id}/payments`, { provider: 'VNPAY' });
    expect(retry.statusCode).toBe(422);
    expect(retry.json<ErrorBody>().errorCode).toBe('payment.error.provider-currency-unsupported');
  });

  it('lets a payment stuck without a session be retried after the session-creation timeout', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop();
    const order = (
      await checkout(headers, {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      })
    ).json<OrderBody>();
    await t.db.payment.updateMany({
      where: { orderId: order.id },
      data: { createdAt: new Date(Date.now() - SESSION_CREATION_TIMEOUT_MS - 1000) },
    });
    const res = await post(headers, `/v1/orders/${order.id}/payments`, {});
    expect(res.statusCode).toBe(201);
    const attempts = await t.db.payment.findMany({
      where: { orderId: order.id },
      orderBy: { attemptNo: 'asc' },
    });
    expect(attempts.map((p) => p.status)).toEqual(['FAILED', 'PENDING']);
  });

  it('rejects a coupon past its usage limit', async () => {
    const { variant, method } = await shop({ stock: 10 });
    await makeCoupon(t.db, { code: 'ONCE', maxRedemptions: 1 });
    const first = await customer();
    const second = await customer();
    const body = (addressId: string) => ({
      items: [{ variantId: variant.id, quantity: 1 }],
      addressId,
      shippingMethodIds: [method.id],
      couponCodes: ['ONCE'],
      provider: 'VNPAY',
    });

    expect((await checkout(first.headers, body(first.address.id))).statusCode).toBe(201);
    const res = await checkout(second.headers, body(second.address.id));
    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>()).toEqual({
      errorCode: 'coupon.error.usage-limit-reached',
      params: { code: 'ONCE' },
    });
    expect(await reserved(variant.id)).toBe(1);

    const unknown = await checkout(second.headers, {
      ...body(second.address.id),
      couponCodes: ['NOPE'],
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<ErrorBody>().errorCode).toBe('coupon.error.not-found');
  });

  it('validates shipping methods per vendor', async () => {
    const { address, headers } = await customer();
    const a = await shop();
    const b = await shop();
    const item = { variantId: a.variant.id, quantity: 1 };

    const foreign = await checkout(headers, {
      items: [item],
      addressId: address.id,
      shippingMethodIds: [b.method.id],
      provider: 'VNPAY',
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json<ErrorBody>()).toEqual({
      errorCode: 'checkout.error.shipping-method-invalid',
      params: { shippingMethodId: b.method.id },
    });

    const missing = await checkout(headers, {
      items: [item, { variantId: b.variant.id, quantity: 1 }],
      addressId: address.id,
      shippingMethodIds: [a.method.id],
      provider: 'VNPAY',
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json<ErrorBody>()).toEqual({
      errorCode: 'checkout.error.shipping-method-missing',
      params: { vendorId: b.vendor.id },
    });

    const second = await makeShippingMethod(t.db, { vendorId: a.vendor.id });
    const twice = await checkout(headers, {
      items: [item],
      addressId: address.id,
      shippingMethodIds: [a.method.id, second.id],
      provider: 'VNPAY',
    });
    expect(twice.statusCode).toBe(422);
    expect(twice.json<ErrorBody>().errorCode).toBe('checkout.error.shipping-method-invalid');
    expect(await t.db.order.count()).toBe(0);
  });

  it('rejects another user’s address, unsellable products and mixed currencies', async () => {
    const { address: mine, headers } = await customer();
    const stranger = await customer();
    const a = await shop();
    const base = {
      items: [{ variantId: a.variant.id, quantity: 1 }],
      shippingMethodIds: [a.method.id],
      provider: 'VNPAY',
    };

    const foreignAddress = await checkout(headers, { ...base, addressId: stranger.address.id });
    expect(foreignAddress.statusCode).toBe(404);
    expect(foreignAddress.json<ErrorBody>().errorCode).toBe('checkout.error.address-not-found');

    await t.db.product.update({ where: { id: a.product.id }, data: { status: 'ARCHIVED' } });
    const archived = await checkout(headers, { ...base, addressId: mine.id });
    expect(archived.statusCode).toBe(409);
    expect(archived.json<ErrorBody>().errorCode).toBe('product.error.not-available');
    await t.db.product.update({ where: { id: a.product.id }, data: { status: 'ACTIVE' } });

    const usd = await makeProduct(t.db, { vendorId: a.vendor.id, currency: 'USD', price: 1_000 });
    const mixed = await checkout(headers, {
      ...base,
      items: [...base.items, { variantId: usd.variants[0]?.id, quantity: 1 }],
      addressId: mine.id,
    });
    expect(mixed.statusCode).toBe(422);
    expect(mixed.json<ErrorBody>().errorCode).toBe('checkout.error.currency-mismatch');
  });

  it('ignores client-sent prices and totals', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop({ price: 100_000, shipping: 30_000 });
    const res = await checkout(headers, {
      items: [{ variantId: variant.id, quantity: 1, unitPrice: { amount: 1, currency: 'VND' } }],
      addressId: address.id,
      shippingMethodIds: [method.id],
      provider: 'VNPAY',
      grandTotal: { amount: 1, currency: 'VND' },
      vendorId: ulid(),
    });
    expect(res.statusCode).toBe(201);
    const order = res.json<OrderBody>();
    expect(order.subOrders[0]?.items[0]?.unitPrice).toEqual(vnd(100_000));
    expect(order.grandTotal).toEqual(vnd(130_000));
    const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.amount).toBe(130_000n);
  });

  it('cancels an unpaid order: stock and coupon uses come back, payment fails, outbox event', async () => {
    const { user, address, headers } = await customer();
    const { variant, method } = await shop({ stock: 3 });
    const coupon = await makeCoupon(t.db, { code: 'ONCE', maxRedemptions: 1 });
    const body = {
      items: [{ variantId: variant.id, quantity: 2 }],
      addressId: address.id,
      shippingMethodIds: [method.id],
      couponCodes: ['ONCE'],
      provider: 'VNPAY',
    };
    const order = (await checkout(headers, body)).json<OrderBody>();
    expect(await reserved(variant.id)).toBe(2);

    const res = await post(headers, `/v1/orders/${order.id}/cancel`);
    expect(res.statusCode).toBe(200);
    const cancelled = res.json<OrderBody>();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.subOrders.every((s) => s.status === 'CANCELLED' && s.cancelledAt)).toBe(true);

    expect(await reserved(variant.id)).toBe(0);
    expect(await t.db.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(0);
    const payment = await t.db.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.status).toBe('FAILED');
    const event = await t.db.outboxEvent.findFirstOrThrow({
      where: { eventType: 'order.cancelled' },
    });
    expect(event.payload).toEqual({ orderId: order.id, customerId: user.id, reason: 'CUSTOMER' });

    const again = await post(headers, `/v1/orders/${order.id}/cancel`);
    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorBody>().errorCode).toBe('order.error.invalid-status-transition');

    // The coupon use was returned: the single-use coupon works again.
    expect((await checkout(headers, body)).statusCode).toBe(201);
  });

  it('refuses to cancel once a sub-order is paid', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop();
    const order = (
      await checkout(headers, {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      })
    ).json<OrderBody>();
    await t.db.subOrder.updateMany({ where: { orderId: order.id }, data: { status: 'PAID' } });

    const res = await post(headers, `/v1/orders/${order.id}/cancel`);
    expect(res.statusCode).toBe(409);
    expect(await reserved(variant.id)).toBe(1);
  });

  it('lists only own orders, newest first, and hides other users’ orders (404)', async () => {
    const me = await customer();
    const other = await customer();
    const { variant, method } = await shop({ stock: 50 });
    const place = async (c: typeof me, qty: number) =>
      (
        await checkout(c.headers, {
          items: [{ variantId: variant.id, quantity: qty }],
          addressId: c.address.id,
          shippingMethodIds: [method.id],
          provider: 'VNPAY',
        })
      ).json<OrderBody>();
    const o1 = await place(me, 1);
    const o2 = await place(me, 2);
    const o3 = await place(me, 3);
    const foreign = await place(other, 1);

    const page1 = await get(me.headers, '/v1/orders?limit=2');
    expect(page1.statusCode).toBe(200);
    const p1 = page1.json<{ items: { id: string; itemCount: number }[]; nextCursor: string }>();
    expect(p1.items.map((o) => o.id)).toEqual([o3.id, o2.id]);
    expect(p1.items[0]).toMatchObject({
      itemCount: 3,
      subOrderCount: 1,
      status: 'AWAITING_PAYMENT',
      grandTotal: vnd(330_000),
    });
    const page2 = await get(me.headers, `/v1/orders?limit=2&cursor=${p1.nextCursor}`);
    const p2 = page2.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(p2.items.map((o) => o.id)).toEqual([o1.id]);
    expect(p2.nextCursor).toBeNull();

    expect((await get(me.headers, `/v1/orders/${o1.id}`)).statusCode).toBe(200);
    for (const res of [
      await get(me.headers, `/v1/orders/${foreign.id}`),
      await get(me.headers, `/v1/orders/${foreign.id}/payment`),
      await post(me.headers, `/v1/orders/${foreign.id}/cancel`),
      await post(me.headers, `/v1/orders/${foreign.id}/payments`, {}),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json<ErrorBody>().errorCode).toBe('order.error.not-found');
    }
    expect((await t.db.order.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      'AWAITING_PAYMENT',
    );
  });

  it('answers 202 until the worker stores the payment session, then 200', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop();
    const order = (
      await checkout(headers, {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'STRIPE',
      })
    ).json<OrderBody>();

    const pending = await get(headers, `/v1/orders/${order.id}/payment`);
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toEqual({ status: 'PENDING', redirectUrl: null, expiresAt: null });

    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await t.db.payment.updateMany({
      where: { orderId: order.id },
      data: { redirectUrl: 'https://checkout.stripe.com/pay/cs_test_123', expiresAt },
    });
    const ready = await get(headers, `/v1/orders/${order.id}/payment`);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'PENDING',
      redirectUrl: 'https://checkout.stripe.com/pay/cs_test_123',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('retries a payment only after the previous attempt failed or expired', async () => {
    const { address, headers } = await customer();
    const { variant, method } = await shop();
    const order = (
      await checkout(headers, {
        items: [{ variantId: variant.id, quantity: 1 }],
        addressId: address.id,
        shippingMethodIds: [method.id],
        provider: 'VNPAY',
      })
    ).json<OrderBody>();
    const retryUrl = `/v1/orders/${order.id}/payments`;

    // Attempt 1 still PENDING without expiry → not allowed.
    const early = await post(headers, retryUrl, {});
    expect(early.statusCode).toBe(409);
    expect(early.json<ErrorBody>()).toEqual({
      errorCode: 'payment.error.retry-not-allowed',
      params: { reason: 'payment-pending' },
    });

    // Session expired → attempt 2 (provider switched), attempt 1 marked FAILED.
    await t.db.payment.updateMany({
      where: { orderId: order.id },
      data: { redirectUrl: 'https://vnpay.vn/pay/1', expiresAt: new Date(Date.now() - 1000) },
    });
    const second = await post(headers, retryUrl, { provider: 'STRIPE' });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual({ status: 'PENDING', redirectUrl: null, expiresAt: null });
    const attempts = await t.db.payment.findMany({
      where: { orderId: order.id },
      orderBy: { attemptNo: 'asc' },
    });
    expect(attempts.map((p) => [p.attemptNo, p.status, p.provider, p.amount])).toEqual([
      [1, 'FAILED', 'VNPAY', 130_000n],
      [2, 'PENDING', 'STRIPE', 130_000n],
    ]);
    const requested = await t.db.outboxEvent.findMany({
      where: { eventType: 'payment.requested' },
      orderBy: { id: 'asc' },
    });
    expect(requested.map((e) => e.payload)).toEqual([
      expect.objectContaining({ attemptNo: 1, provider: 'VNPAY' }),
      { orderId: order.id, paymentId: attempts[1]?.id, provider: 'STRIPE', attemptNo: 2 },
    ]);
    expect((await get(headers, `/v1/orders/${order.id}/payment`)).statusCode).toBe(202);

    // Attempt 2 FAILED → attempt 3 keeps the last provider.
    await t.db.payment.updateMany({ where: { attemptNo: 2 }, data: { status: 'FAILED' } });
    const third = await post(headers, retryUrl, {});
    expect(third.statusCode).toBe(201);
    const latest = await t.db.payment.findFirstOrThrow({ where: { attemptNo: 3 } });
    expect(latest.provider).toBe('STRIPE');

    // Deadline passed → not allowed.
    await t.db.payment.updateMany({ where: { attemptNo: 3 }, data: { status: 'FAILED' } });
    await t.db.order.update({
      where: { id: order.id },
      data: { paymentDeadlineAt: new Date(Date.now() - 1000) },
    });
    const late = await post(headers, retryUrl, {});
    expect(late.statusCode).toBe(409);
    expect(late.json<ErrorBody>().params).toEqual({ reason: 'deadline-passed' });

    // Cancelled order → invalid transition.
    await t.db.order.update({
      where: { id: order.id },
      data: { paymentDeadlineAt: new Date(Date.now() + 60_000) },
    });
    expect((await post(headers, `/v1/orders/${order.id}/cancel`)).statusCode).toBe(200);
    const afterCancel = await post(headers, retryUrl, {});
    expect(afterCancel.statusCode).toBe(409);
    expect(afterCancel.json<ErrorBody>().errorCode).toBe('order.error.invalid-status-transition');
  });
});
