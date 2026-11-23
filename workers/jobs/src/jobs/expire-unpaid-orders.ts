import { deriveOrderStatus, ORDER_AGGREGATE_TYPE, OrderCancelledEventSchema } from '@repo/core';
import { prisma } from '@repo/db';
import { ulid } from 'ulid';
import { lockOrder, quantitiesByVariant, subOrderStatuses } from '../domain/orders';
import type { Tx } from '../outbox/handler';
import { forEachCandidate, JOB_TX_OPTIONS, type ItemOutcome, type JobContext } from './run';

/**
 * `expire-unpaid-orders`: AWAITING_PAYMENT orders past `paymentDeadlineAt` (DB clock) are
 * cancelled with reason `PAYMENT_EXPIRED`, one transaction per order.
 */
export function expireUnpaidOrders(ctx: JobContext) {
  return forEachCandidate(
    ctx,
    (afterId, limit) => prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders
      WHERE status = 'AWAITING_PAYMENT'
        AND payment_deadline_at < (now() AT TIME ZONE 'UTC')
        AND id > ${afterId}
      ORDER BY id
      LIMIT ${limit}::int`,
    (order) => prisma.$transaction((tx) => expireOrder(tx, order.id), JOB_TX_OPTIONS),
  );
}

/**
 * The API's `cancelOrder(tx, orderId, 'PAYMENT_EXPIRED')` contract (server
 * `src/orders/order-cancellation.ts`), step by step, plus the overdue re-check under the lock:
 *
 * 1. Lock the order row (`FOR UPDATE`) — a payment confirmation takes the same first lock, so a
 *    late "paid" webhook and the expiry serialise; whichever commits first wins.
 * 2. Still AWAITING_PAYMENT, still overdue, and EVERY sub-order AWAITING_PAYMENT — else nothing
 *    is written (`skipped`).
 * 3. Sub-orders → CANCELLED + `cancelledAt` `WHERE status = 'AWAITING_PAYMENT'` (count mismatch
 *    throws → rollback).
 * 4. Release `stock_reserved` per variant in variant-id order, clamped at 0.
 * 5. Delete the order's CouponRedemptions.
 * 6. PENDING payments → FAILED.
 * 7. `orders.status = deriveOrderStatus(...)` (CANCELLED).
 * 8. Outbox `order.cancelled {orderId, customerId, reason: 'PAYMENT_EXPIRED'}`.
 */
export async function expireOrder(tx: Tx, orderId: string): Promise<ItemOutcome> {
  const order = await lockOrder(tx, orderId);
  if (!order || order.status !== 'AWAITING_PAYMENT') return 'skipped';
  const [overdue] = await tx.$queryRaw<{ overdue: boolean }[]>`
    SELECT payment_deadline_at < (now() AT TIME ZONE 'UTC') AS overdue
    FROM orders WHERE id = ${orderId}`;
  if (!overdue?.overdue) return 'skipped';

  const subOrders = await tx.subOrder.findMany({
    where: { orderId },
    select: { status: true, items: { select: { variantId: true, quantity: true } } },
  });
  if (subOrders.length === 0 || subOrders.some((so) => so.status !== 'AWAITING_PAYMENT')) {
    return 'skipped';
  }

  const updated = await tx.subOrder.updateMany({
    where: { orderId, status: 'AWAITING_PAYMENT' },
    data: { status: 'CANCELLED', cancelledAt: order.dbNow },
  });
  if (updated.count !== subOrders.length) {
    throw new Error(`expire: sub-orders of ${orderId} changed under the order lock`);
  }

  for (const [variantId, qty] of quantitiesByVariant(subOrders.flatMap((so) => so.items))) {
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

  await tx.order.update({
    where: { id: orderId },
    data: { status: deriveOrderStatus(await subOrderStatuses(tx, orderId)) },
  });
  await tx.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: ORDER_AGGREGATE_TYPE,
      aggregateId: orderId,
      eventType: 'order.cancelled',
      payload: OrderCancelledEventSchema.parse({
        orderId,
        customerId: order.customerId,
        reason: 'PAYMENT_EXPIRED',
      }),
    },
  });
  return 'done';
}
