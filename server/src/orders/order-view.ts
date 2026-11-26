import {
  type Locale,
  type Order,
  OrderSchema,
  type OrderSummary,
  OrderSummarySchema,
  type PaymentSession,
  type SubOrder,
  SubOrderSchema,
  PaymentSessionSchema,
  ShippingAddressSnapshotSchema,
  VariantAttributesSchema,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';

// Read side of orders: Prisma include shapes + mapping to the `@repo/core` response schemas.
// Every mapper ends with `Schema.parse`, so ids are branded and a drifted row fails loudly.

/** One sub-order with what `toSubOrder` needs (customer order detail + vendor fulfilment). */
export const SUB_ORDER_DETAIL_ARGS = {
  include: {
    vendor: { select: { displayName: true } },
    shippingMethod: { select: { name: true } },
    items: {
      orderBy: { id: 'asc' },
      include: {
        variant: {
          select: {
            productId: true,
            product: { select: { translations: { select: { locale: true, slug: true } } } },
          },
        },
      },
    },
  },
} satisfies Prisma.SubOrderDefaultArgs;

export type SubOrderDetailRow = Prisma.SubOrderGetPayload<typeof SUB_ORDER_DETAIL_ARGS>;

export const ORDER_DETAIL_ARGS = {
  include: {
    subOrders: { orderBy: { id: 'asc' }, ...SUB_ORDER_DETAIL_ARGS },
  },
} satisfies Prisma.OrderDefaultArgs;

export type OrderDetailRow = Prisma.OrderGetPayload<typeof ORDER_DETAIL_ARGS>;

export const ORDER_SUMMARY_ARGS = {
  include: { subOrders: { select: { items: { select: { quantity: true } } } } },
} satisfies Prisma.OrderDefaultArgs;

export type OrderSummaryRow = Prisma.OrderGetPayload<typeof ORDER_SUMMARY_ARGS>;

export function toOrder(row: OrderDetailRow, locale: Locale = 'VI'): Order {
  const money = (amount: bigint) => toMoney(amount, row.currency);
  return OrderSchema.parse({
    id: row.id,
    status: row.status,
    itemsTotal: money(row.itemsTotalAmount),
    shippingTotal: money(row.shippingTotalAmount),
    discountTotal: money(row.discountTotalAmount),
    grandTotal: money(row.grandTotalAmount),
    paymentDeadlineAt: row.paymentDeadlineAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    subOrders: row.subOrders.map((so) => toSubOrder(so, locale)),
  });
}

/** Customer view of one sub-order (no commission); `paid_i` as `total`. */
export function toSubOrder(so: SubOrderDetailRow, locale: Locale = 'VI'): SubOrder {
  const subtotal = toMoney(so.subtotalAmount, so.currency);
  const shipping = toMoney(so.shippingAmount, so.currency);
  const vendorDiscount = toMoney(so.discountAmount, so.currency);
  const platformDiscount = toMoney(so.platformDiscountAmount, so.currency);
  return SubOrderSchema.parse({
    id: so.id,
    orderId: so.orderId,
    vendorId: so.vendorId,
    vendorName: so.vendor.displayName,
    status: so.status,
    subtotal,
    shipping,
    vendorDiscount,
    platformDiscount,
    // paid_i (D7) = subtotal + shipping − vendorDiscount − platformDiscount
    total: toMoney(
      so.subtotalAmount + so.shippingAmount - so.discountAmount - so.platformDiscountAmount,
      so.currency,
    ),
    shippingMethodName: so.shippingMethod?.name ?? null,
    shippingAddress: ShippingAddressSnapshotSchema.parse(so.shippingAddress),
    carrier: so.carrier,
    trackingNumber: so.trackingNumber,
    shippedAt: so.shippedAt?.toISOString() ?? null,
    deliveredAt: so.deliveredAt?.toISOString() ?? null,
    completedAt: so.completedAt?.toISOString() ?? null,
    cancelledAt: so.cancelledAt?.toISOString() ?? null,
    createdAt: so.createdAt.toISOString(),
    items: so.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productId: item.variant.productId,
      productSlug: pickSlug(item.variant.product.translations, locale),
      productTitle: item.productTitleSnapshot,
      attributes: parseAttributes(item.variantAttributesSnapshot),
      unitPrice: toMoney(item.unitPriceAmount, item.currency),
      quantity: item.quantity,
      lineTotal: toMoney(item.lineTotalAmount, item.currency),
    })),
  });
}

export function toOrderSummary(row: OrderSummaryRow): OrderSummary {
  return OrderSummarySchema.parse({
    id: row.id,
    status: row.status,
    grandTotal: toMoney(row.grandTotalAmount, row.currency),
    itemCount: row.subOrders.reduce(
      (n, so) => n + so.items.reduce((m, item) => m + item.quantity, 0),
      0,
    ),
    subOrderCount: row.subOrders.length,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toPaymentSession(payment: {
  status: PaymentSession['status'];
  redirectUrl: string | null;
  expiresAt: Date | null;
}): PaymentSession {
  return PaymentSessionSchema.parse({
    status: payment.status,
    redirectUrl: payment.redirectUrl,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
  });
}

/** Attributes snapshot is written from a validated variant; a malformed legacy row reads as `{}`. */
export function parseAttributes(
  value: unknown,
): Order['subOrders'][number]['items'][number]['attributes'] {
  const parsed = VariantAttributesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** Slug in the wanted locale, else vi, else any translation; null when the product has none. */
export function pickSlug(
  translations: readonly { locale: Locale; slug: string }[],
  locale: Locale,
): string | null {
  const pick = (l: Locale) => translations.find((t) => t.locale === l)?.slug;
  return pick(locale) ?? pick('VI') ?? translations[0]?.slug ?? null;
}
