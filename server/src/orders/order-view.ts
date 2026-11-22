import {
  type Order,
  OrderSchema,
  type OrderSummary,
  OrderSummarySchema,
  type PaymentSession,
  PaymentSessionSchema,
  ShippingAddressSnapshotSchema,
  VariantAttributesSchema,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';

// Read side of orders: Prisma include shapes + mapping to the `@repo/core` response schemas.
// Every mapper ends with `Schema.parse`, so ids are branded and a drifted row fails loudly.

export const ORDER_DETAIL_ARGS = {
  include: {
    subOrders: {
      orderBy: { id: 'asc' },
      include: {
        vendor: { select: { displayName: true } },
        shippingMethod: { select: { name: true } },
        items: {
          orderBy: { id: 'asc' },
          include: { variant: { select: { productId: true } } },
        },
      },
    },
  },
} satisfies Prisma.OrderDefaultArgs;

export type OrderDetailRow = Prisma.OrderGetPayload<typeof ORDER_DETAIL_ARGS>;

export const ORDER_SUMMARY_ARGS = {
  include: { subOrders: { select: { items: { select: { quantity: true } } } } },
} satisfies Prisma.OrderDefaultArgs;

export type OrderSummaryRow = Prisma.OrderGetPayload<typeof ORDER_SUMMARY_ARGS>;

export function toOrder(row: OrderDetailRow): Order {
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
    subOrders: row.subOrders.map((so) => {
      const subtotal = toMoney(so.subtotalAmount, so.currency);
      const shipping = toMoney(so.shippingAmount, so.currency);
      const vendorDiscount = toMoney(so.discountAmount, so.currency);
      const platformDiscount = toMoney(so.platformDiscountAmount, so.currency);
      return {
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
          productTitle: item.productTitleSnapshot,
          attributes: parseAttributes(item.variantAttributesSnapshot),
          unitPrice: toMoney(item.unitPriceAmount, item.currency),
          quantity: item.quantity,
          lineTotal: toMoney(item.lineTotalAmount, item.currency),
        })),
      };
    }),
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
