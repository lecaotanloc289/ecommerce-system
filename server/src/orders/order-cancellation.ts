import {
  deriveOrderStatus,
  ORDER_AGGREGATE_TYPE,
  type OrderCancelReason,
  type OrderCancelledEvent,
  OrderCancelledEventSchema,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';

export type CancelOrderResult = 'cancelled' | 'not-found' | 'not-cancellable';

/**
 * Cancels an unpaid order. Contract shared with the payment-expiry job (T3.2), which must mirror
 * it step by step — call it inside the caller's transaction:
 *
 * 1. `SELECT … FROM orders WHERE id = $1 FOR UPDATE` — the payment confirmation (T3.1) must take
 *    the same lock first, so cancel vs. a late "paid" webhook serialise on the order row.
 * 2. Only when EVERY sub-order is AWAITING_PAYMENT (else nothing is written → 'not-cancellable').
 * 3. Sub-orders → CANCELLED + `cancelledAt` with `WHERE status = 'AWAITING_PAYMENT'`; a count
 *    mismatch (a concurrent writer slipped past the lock) throws, rolling the caller back.
 * 4. Release `stock_reserved` per variant (D4), in variant-id order (same order as checkout
 *    reserves, so the two never deadlock), clamped at 0.
 * 5. Delete the order's CouponRedemptions (the coupon uses come back).
 * 6. PENDING payments → FAILED (a session the customer still opens can no longer be confirmed
 *    into a cancelled order without the T3.1 refund path).
 * 7. `orders.status` = `deriveOrderStatus(...)` (→ CANCELLED).
 * 8. Outbox `order.cancelled` `{ orderId, customerId, reason }`.
 *
 * Ownership is the caller's job (the customer endpoint checks `customerId` first).
 */
export async function cancelOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: OrderCancelReason,
): Promise<CancelOrderResult> {
  const locked = await tx.$queryRaw<{ id: string; customer_id: string }[]>`
    SELECT id, customer_id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  const order = locked[0];
  if (!order) return 'not-found';

  const subOrders = await tx.subOrder.findMany({
    where: { orderId },
    select: { id: true, status: true, items: { select: { variantId: true, quantity: true } } },
  });
  if (subOrders.length === 0 || subOrders.some((so) => so.status !== 'AWAITING_PAYMENT')) {
    return 'not-cancellable';
  }

  const now = new Date();
  const updated = await tx.subOrder.updateMany({
    where: { orderId, status: 'AWAITING_PAYMENT' },
    data: { status: 'CANCELLED', cancelledAt: now },
  });
  if (updated.count !== subOrders.length) {
    throw new Error(`cancelOrder: sub-orders of ${orderId} changed under the order lock`);
  }

  const reserved = new Map<string, number>();
  for (const item of subOrders.flatMap((so) => so.items)) {
    reserved.set(item.variantId, (reserved.get(item.variantId) ?? 0) + item.quantity);
  }
  for (const [variantId, qty] of [...reserved].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    await tx.$executeRaw`
      UPDATE product_variants
      SET stock_reserved = GREATEST(stock_reserved - ${qty}, 0), updated_at = now()
      WHERE id = ${variantId}`;
  }

  await tx.couponRedemption.deleteMany({ where: { orderId } });
  await tx.payment.updateMany({
    where: { orderId, status: 'PENDING' },
    data: { status: 'FAILED' },
  });

  const statuses = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });
  await tx.order.update({
    where: { id: orderId },
    data: { status: deriveOrderStatus(statuses.map((s) => s.status)) },
  });

  const payload: OrderCancelledEvent = OrderCancelledEventSchema.parse({
    orderId: order.id,
    customerId: order.customer_id,
    reason,
  });
  await tx.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: ORDER_AGGREGATE_TYPE,
      aggregateId: orderId,
      eventType: 'order.cancelled',
      payload,
    },
  });
  return 'cancelled';
}
