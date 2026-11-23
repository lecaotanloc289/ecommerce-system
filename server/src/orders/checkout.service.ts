import { Injectable } from '@nestjs/common';
import {
  type AppliedCoupon,
  type Checkout,
  type Coupon,
  CouponSchema,
  type Currency,
  DomainError,
  Money,
  ORDER_AGGREGATE_TYPE,
  OrderCreatedEventSchema,
  PaymentRequestedEventSchema,
  type PricingSubOrderInput,
  ShippingAddressSnapshotSchema,
  VendorIdSchema,
  priceOrder,
  providerSupportsCurrency,
  resolveCommissionBps,
} from '@repo/core';
import { type Prisma, toDbAmount, toMoney } from '@repo/db';
import { monotonicFactory } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { queueZaloMessages } from '../zalo/zalo-message-queue';
import { parseAttributes } from './order-view';

type Tx = Prisma.TransactionClient;

/** Monotonic so sub-orders / items created in one checkout keep their creation order by id. */
const ulid = monotonicFactory();

/** Interactive transaction budget: row locks on coupons/variants may make a checkout wait. */
const CHECKOUT_TX_TIMEOUT_MS = 15_000;

const VARIANT_ARGS = {
  include: {
    product: {
      select: {
        id: true,
        status: true,
        vendorId: true,
        vendor: { select: { status: true, commissionBpsOverride: true } },
        categories: { select: { category: { select: { commissionBpsOverride: true } } } },
        translations: { select: { locale: true, name: true } },
      },
    },
  },
} satisfies Prisma.ProductVariantFindManyArgs;

type VariantRow = Prisma.ProductVariantGetPayload<typeof VARIANT_ARGS>;

interface Line {
  variant: VariantRow;
  quantity: number;
}

interface VendorGroup {
  vendorId: string;
  lines: Line[];
}

/**
 * `POST /v1/orders/checkout` (Golden Rules #3, #4, #9; roadmap D3-D9). Everything happens in ONE
 * interactive transaction (READ COMMITTED + row locks); any thrown error rolls back every write,
 * including stock reservations. Client-sent prices / vendor ids do not exist in the body and are
 * never trusted: price, vendor, commission and shipping all come from the DB.
 */
@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the id of the created order, or of the order this key already created. `clientIp` is
   * the caller IP (`clientIp()`), stored on the Payment for VNPay `vnp_IpAddr`.
   */
  async checkout(
    userId: string,
    input: Checkout,
    idempotencyKey: string,
    clientIp: string,
  ): Promise<string> {
    // The Redis record (D9) normally answers replays; this covers an expired record or lost lock.
    const existing = await this.findByIdempotencyKey(userId, idempotencyKey, input);
    if (existing) return existing;
    try {
      return await this.prisma.client.$transaction(
        (tx) => this.checkoutInTx(tx, userId, input, idempotencyKey, clientIp),
        { timeout: CHECKOUT_TX_TIMEOUT_MS },
      );
    } catch (error) {
      // DB backstop: a concurrent request with the same key may have committed first. It surfaces
      // as P2002 on `orders.idempotency_key` — or as any earlier failure (e.g. out-of-stock on the
      // unit the winner just reserved) — so on every error, answer with the winner's order if any.
      const winner = await this.findByIdempotencyKey(userId, idempotencyKey, input);
      if (winner) return winner;
      throw error;
    }
  }

  /**
   * The order created with this key, if any. Another user's order, or one built from a different
   * request (items, shipping methods, provider), → 422 `idempotency.error.key-reused`.
   */
  private async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    input: Checkout,
  ): Promise<string | null> {
    const order = await this.prisma.client.order.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        customerId: true,
        subOrders: {
          select: {
            shippingMethodId: true,
            items: { select: { variantId: true, quantity: true } },
          },
        },
        payments: { where: { attemptNo: 1 }, select: { provider: true } },
      },
    });
    if (!order) return null;
    const items = order.subOrders.flatMap((so) => so.items);
    const sameItems =
      items.length === input.items.length &&
      input.items.every((i) =>
        items.some((o) => o.variantId === i.variantId && o.quantity === i.quantity),
      );
    const methods = new Set(order.subOrders.map((so) => so.shippingMethodId));
    const sameShipping =
      methods.size === input.shippingMethodIds.length &&
      input.shippingMethodIds.every((id) => methods.has(id));
    const sameProvider = order.payments[0]?.provider === input.provider;
    if (order.customerId !== userId || !sameItems || !sameShipping || !sameProvider) {
      throw new DomainError('idempotency.error.key-reused');
    }
    return order.id;
  }

  private async checkoutInTx(
    tx: Tx,
    userId: string,
    input: Checkout,
    idempotencyKey: string,
    clientIp: string,
  ): Promise<string> {
    const now = new Date();

    // 1. Platform settings + the buyer.
    const settings = await tx.platformSettings.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!settings) throw new Error('PlatformSettings row is missing (run the seed)');
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { primaryLocale: true },
    });
    if (!user) throw new DomainError('common.error.unauthorized');

    // 2. Variants + product + vendor + categories; every line must be sellable.
    const variants = await tx.productVariant.findMany({
      where: { id: { in: input.items.map((i) => i.variantId) } },
      ...VARIANT_ARGS,
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const lines: Line[] = input.items.map(({ variantId, quantity }) => {
      const variant = byId.get(variantId);
      if (!variant) throw new DomainError('product.error.variant-not-found', { variantId });
      if (variant.product.status !== 'ACTIVE' || variant.product.vendor.status !== 'ACTIVE') {
        throw new DomainError('product.error.not-available', { variantId });
      }
      return { variant, quantity };
    });

    // 3. One order = one currency (D6), and the platform must support it.
    const currencies = new Set(lines.map((l) => l.variant.priceCurrency));
    const [currency] = currencies;
    if (currency === undefined || currencies.size > 1) {
      throw new DomainError('checkout.error.currency-mismatch');
    }
    if (!settings.supportedCurrencies.includes(currency)) {
      throw new DomainError('checkout.error.currency-mismatch', { currency });
    }
    if (!providerSupportsCurrency(input.provider, currency)) {
      throw new DomainError('payment.error.provider-currency-unsupported', {
        provider: input.provider,
        currency,
      });
    }

    // 4. The buyer's own address → immutable snapshot.
    const address = await tx.address.findFirst({ where: { id: input.addressId, userId } });
    if (!address) throw new DomainError('checkout.error.address-not-found');
    const shippingAddress = ShippingAddressSnapshotSchema.parse({
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      ward: address.ward,
      district: address.district,
      city: address.city,
      country: address.country,
    });

    // 5. Group by vendor (first-appearance order) and pick exactly one shipping method each.
    const groups = groupByVendor(lines);
    const methodByVendor = await this.resolveShippingMethods(tx, input, groups, currency);

    // 6. Coupons, locked so usage counts cannot race (maxRedemptions / perUserLimit).
    const { vendorCoupons, platformCoupons } = await this.resolveCoupons(
      tx,
      userId,
      input.couponCodes,
      groups.map((g) => g.vendorId),
      currency,
    );

    // 7. Price it (D5-D8): commission bps per line, then the pure pricing engine.
    const subOrderInputs: PricingSubOrderInput[] = groups.map((group) => {
      const method = methodByVendor.get(group.vendorId);
      if (!method) throw new DomainError('checkout.error.shipping-method-missing');
      return {
        vendorId: VendorIdSchema.parse(group.vendorId),
        shipping: toMoney(method.priceAmount, method.priceCurrency),
        lines: group.lines.map(({ variant, quantity }) => ({
          unitPrice: toMoney(variant.priceAmount, variant.priceCurrency),
          qty: quantity,
          commissionBps: resolveCommissionBps({
            vendorOverride: variant.product.vendor.commissionBpsOverride,
            categoryOverrides: variant.product.categories.map(
              (c) => c.category.commissionBpsOverride,
            ),
            platformBps: settings.commissionBps,
          }),
        })),
      };
    });
    const priced = priceOrder({
      currency,
      subOrders: subOrderInputs,
      vendorCoupons,
      platformCoupons,
      maxCouponStack: settings.maxCouponStack,
      now,
    });

    // 8. Reserve stock (D4), in variant-id order so concurrent checkouts never deadlock. A miss
    //    throws → the whole transaction (earlier reservations included) rolls back.
    const reservations = [...lines].sort((a, b) => compareIds(a.variant.id, b.variant.id));
    for (const { variant, quantity } of reservations) {
      const reserved = await tx.$executeRaw`
        UPDATE product_variants
        SET stock_reserved = stock_reserved + ${quantity}, updated_at = now()
        WHERE id = ${variant.id} AND stock_on_hand - stock_reserved >= ${quantity}`;
      if (reserved === 0) {
        throw new DomainError('checkout.error.out-of-stock', { variantId: variant.id });
      }
    }

    // 9. Order + sub-orders + items + redemptions + payment + outbox.
    const orderId = ulid();
    await tx.order.create({
      data: {
        id: orderId,
        customerId: userId,
        status: 'AWAITING_PAYMENT',
        currency,
        itemsTotalAmount: toDbAmount(priced.itemsTotal),
        shippingTotalAmount: toDbAmount(priced.shippingTotal),
        discountTotalAmount: toDbAmount(priced.discountTotal),
        grandTotalAmount: toDbAmount(priced.grandTotal),
        idempotencyKey,
        paymentDeadlineAt: new Date(now.getTime() + settings.paymentTimeoutMinutes * 60_000),
        zaloOptIn: input.zaloOptIn,
      },
    });

    const subOrderIdByVendor = new Map<string, string>();
    const titleLocale = user.primaryLocale;
    const subOrderRows: Prisma.SubOrderCreateManyInput[] = [];
    const itemRows: Prisma.OrderItemCreateManyInput[] = [];
    groups.forEach((group, index) => {
      const p = priced.subOrders[index];
      const method = methodByVendor.get(group.vendorId);
      if (!p || !method || p.vendorId !== group.vendorId) {
        throw new Error('checkout: pricing result does not line up with the vendor groups');
      }
      const subOrderId = ulid();
      subOrderIdByVendor.set(group.vendorId, subOrderId);
      subOrderRows.push({
        id: subOrderId,
        orderId,
        vendorId: group.vendorId,
        status: 'AWAITING_PAYMENT',
        subtotalAmount: toDbAmount(p.subtotal),
        shippingAmount: toDbAmount(p.shipping),
        discountAmount: toDbAmount(p.vendorDiscount),
        platformDiscountAmount: toDbAmount(p.platformDiscount),
        commissionAmount: toDbAmount(p.commission),
        currency,
        shippingMethodId: method.id,
        shippingAddress,
      });
      for (const { variant, quantity } of group.lines) {
        const unitPrice = toMoney(variant.priceAmount, variant.priceCurrency);
        const translations = variant.product.translations;
        const title =
          translations.find((t) => t.locale === titleLocale) ??
          translations.find((t) => t.locale === 'VI') ??
          translations[0];
        itemRows.push({
          id: ulid(),
          subOrderId,
          variantId: variant.id,
          productTitleSnapshot: title?.name ?? variant.sku,
          variantAttributesSnapshot: parseAttributes(variant.attributes),
          unitPriceAmount: toDbAmount(unitPrice),
          quantity,
          lineTotalAmount: toDbAmount(Money.multiply(unitPrice, quantity)),
          currency,
        });
      }
    });
    await tx.subOrder.createMany({ data: subOrderRows });
    await tx.orderItem.createMany({ data: itemRows });

    if (priced.redemptions.length > 0) {
      await tx.couponRedemption.createMany({
        data: priced.redemptions.map((r) => ({
          id: ulid(),
          couponId: r.couponId,
          userId,
          // Every redemption carries the order (cancel deletes by orderId); vendor coupons also
          // point at their sub-order, platform coupons are order-level only.
          orderId,
          subOrderId: r.vendorId === null ? null : (subOrderIdByVendor.get(r.vendorId) ?? null),
          discountAmount: toDbAmount(r.discount),
          currency,
        })),
      });
    }

    // D2/D3: a PENDING attempt without a provider session; the worker creates it. No ledger here.
    const paymentId = ulid();
    await tx.payment.create({
      data: {
        id: paymentId,
        orderId,
        provider: input.provider,
        status: 'PENDING',
        attemptNo: 1,
        amount: toDbAmount(priced.grandTotal),
        currency,
        clientIp,
      },
    });

    await tx.outboxEvent.createMany({
      data: [
        {
          id: ulid(),
          aggregateType: ORDER_AGGREGATE_TYPE,
          aggregateId: orderId,
          eventType: 'order.created',
          payload: OrderCreatedEventSchema.parse({ orderId, customerId: userId }),
        },
        {
          id: ulid(),
          aggregateType: ORDER_AGGREGATE_TYPE,
          aggregateId: orderId,
          eventType: 'payment.requested',
          payload: PaymentRequestedEventSchema.parse({
            orderId,
            paymentId,
            provider: input.provider,
            attemptNo: 1,
          }),
        },
      ],
    });

    await queueZaloMessages(tx, {
      subOrderIds: subOrderRows.map((row) => row.id),
      event: 'ORDER_PLACED',
      now,
    });

    // The purchased variants leave the server cart.
    await tx.cartItem.deleteMany({
      where: { cart: { userId }, variantId: { in: lines.map((l) => l.variant.id) } },
    });

    return orderId;
  }

  /**
   * One active shipping method per vendor of the order, owned by that vendor, in the order
   * currency. Unknown / inactive / foreign / duplicate-per-vendor ids → `-invalid`; a vendor
   * without one → `-missing`.
   */
  private async resolveShippingMethods(
    tx: Tx,
    input: Checkout,
    groups: readonly VendorGroup[],
    currency: Currency,
  ) {
    const vendorIds = new Set(groups.map((g) => g.vendorId));
    const methods = await tx.shippingMethod.findMany({
      where: { id: { in: input.shippingMethodIds } },
    });
    const byId = new Map(methods.map((m) => [m.id, m]));
    const byVendor = new Map<string, (typeof methods)[number]>();
    for (const shippingMethodId of input.shippingMethodIds) {
      const method = byId.get(shippingMethodId);
      if (
        !method ||
        !method.isActive ||
        !vendorIds.has(method.vendorId) ||
        method.priceCurrency !== currency ||
        byVendor.has(method.vendorId)
      ) {
        throw new DomainError('checkout.error.shipping-method-invalid', { shippingMethodId });
      }
      byVendor.set(method.vendorId, method);
    }
    for (const vendorId of vendorIds) {
      if (!byVendor.has(vendorId)) {
        throw new DomainError('checkout.error.shipping-method-missing', { vendorId });
      }
    }
    return byVendor;
  }

  /**
   * Codes → coupons. A code is a PLATFORM coupon when an active one has it (platform codes are
   * globally unique and take precedence, so a vendor cannot shadow them); otherwise it is the
   * VENDOR coupon(s) with that code of the vendors in this order. Rows are locked
   * (`FOR UPDATE`, id order) before reading them and counting redemptions, so two checkouts
   * cannot both take the last use. Eligibility itself is judged by `priceOrder`.
   */
  private async resolveCoupons(
    tx: Tx,
    userId: string,
    codes: readonly string[],
    vendorIds: readonly string[],
    currency: Currency,
  ): Promise<{ vendorCoupons: AppliedCoupon[]; platformCoupons: AppliedCoupon[] }> {
    if (codes.length === 0) return { vendorCoupons: [], platformCoupons: [] };

    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM coupons
      WHERE code = ANY(${codes}::text[])
        AND ((scope = 'PLATFORM' AND vendor_id IS NULL) OR vendor_id = ANY(${vendorIds}::text[]))
      ORDER BY id
      FOR UPDATE`;
    const ids = locked.map((r) => r.id);
    const rows = await tx.coupon.findMany({ where: { id: { in: ids } } });
    const [totals, mine] = await Promise.all([
      tx.couponRedemption.groupBy({
        by: ['couponId'],
        where: { couponId: { in: ids } },
        _count: { _all: true },
      }),
      tx.couponRedemption.groupBy({
        by: ['couponId'],
        where: { couponId: { in: ids }, userId },
        _count: { _all: true },
      }),
    ]);
    const totalOf = new Map(totals.map((g) => [g.couponId, g._count._all]));
    const mineOf = new Map(mine.map((g) => [g.couponId, g._count._all]));

    const vendorCoupons: AppliedCoupon[] = [];
    const platformCoupons: AppliedCoupon[] = [];
    for (const code of codes) {
      const platform = rows.find((r) => r.scope === 'PLATFORM' && r.code === code && r.isActive);
      const matches = platform
        ? [platform]
        : rows.filter((r) => r.scope === 'VENDOR' && r.code === code);
      if (matches.length === 0) throw new DomainError('coupon.error.not-found', { code });
      for (const row of matches) {
        const totalRedemptions = totalOf.get(row.id) ?? 0;
        const applied: AppliedCoupon = {
          coupon: toCoupon(row, currency, totalRedemptions),
          totalRedemptions,
          userRedemptions: mineOf.get(row.id) ?? 0,
        };
        (row.scope === 'PLATFORM' ? platformCoupons : vendorCoupons).push(applied);
      }
    }
    return { vendorCoupons, platformCoupons };
  }
}

type CouponRow = Prisma.CouponGetPayload<object>;

/** DB row → core `Coupon`. A coupon priced in another currency cannot apply to this order. */
function toCoupon(row: CouponRow, currency: Currency, redemptionCount: number): Coupon {
  if (row.currency !== null && row.currency !== currency) {
    throw new DomainError('checkout.error.currency-mismatch', { code: row.code });
  }
  const discount =
    row.discountType === 'FIXED'
      ? { discountType: 'FIXED', discount: toMoney(row.discountValue, currency) }
      : { discountType: 'PERCENT', discountBps: Number(row.discountValue) };
  return CouponSchema.parse({
    id: row.id,
    scope: row.scope,
    vendorId: row.vendorId,
    code: row.code,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    minSpend: row.minSpendAmount === null ? null : toMoney(row.minSpendAmount, currency),
    maxRedemptions: row.maxRedemptions,
    perUserLimit: row.perUserLimit,
    isActive: row.isActive,
    redemptionCount,
    ...discount,
  });
}

function groupByVendor(lines: readonly Line[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  for (const line of lines) {
    const vendorId = line.variant.product.vendorId;
    const group = groups.get(vendorId) ?? { vendorId, lines: [] };
    group.lines.push(line);
    groups.set(vendorId, group);
  }
  return [...groups.values()];
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
