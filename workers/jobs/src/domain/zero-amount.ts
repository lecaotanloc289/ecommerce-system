import {
  computeEscrowInPostings,
  deriveOrderStatus,
  Money,
  ORDER_AGGREGATE_TYPE,
  OrderPaidEventSchema,
  subOrderPaid,
} from '@repo/core';
import { queueZaloStatusMessages, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import type { Logger } from '../logger';
import type { Tx } from '../outbox/handler';
import { insertLedger, ledgerGroup } from './ledger';
import { commitStock, lockOrder } from './orders';

/**
 * - `confirmed`      — payment CONFIRMED, sub-orders + order PAID, stock committed, `order.paid`
 * - `not-applicable` — nothing written: payment gone / not PENDING / not 0, or order not unpaid
 * - `manual-review`  — payment CONFIRMED but the order is inconsistent (a sub-order is no
 *                      longer AWAITING_PAYMENT): logged at error, nothing else written
 */
export type ZeroAmountOutcome = 'confirmed' | 'not-applicable' | 'manual-review';

/**
 * Confirms a payment of amount 0 (free order) — the worker's mirror of the API's
 * `PaymentConfirmationService.confirmZeroAmount` → `applyInTx` → `markOrderPaid` (server
 * CLAUDE.md "Payments → Zero amount"), inside the caller's transaction:
 *
 * 1. Lock the order row, then the payment row (same lock order as the API).
 * 2. Only a PENDING payment of 0 on an AWAITING_PAYMENT order (else nothing is written — a
 *    zero-amount confirmation moves no money, so a cancelled order simply stays cancelled).
 * 3. Payment → CONFIRMED, `providerTxnId` = paymentId, `rawPayload {zeroAmount: true}`.
 * 4. Every sub-order must be AWAITING_PAYMENT (else `manual-review`, as the API): other PENDING
 *    attempts → FAILED; sub-orders → PAID (count must match); stock committed in variant-id order.
 * 5. Escrow IN per sub-order with `paid_i > 0` — none for a consistent free order (all 0).
 * 6. `orders.status = deriveOrderStatus(...)` (PAID); outbox `order.paid`.
 */
export async function confirmZeroAmountPayment(
  tx: Tx,
  paymentId: string,
  log: Logger,
): Promise<ZeroAmountOutcome> {
  const ref = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
  if (!ref) return 'not-applicable';

  const order = await lockOrder(tx, ref.orderId);
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { status: true, amount: true },
  });
  if (!order || payment.status !== 'PENDING' || payment.amount !== 0n) return 'not-applicable';
  if (order.status !== 'AWAITING_PAYMENT') return 'not-applicable';

  const marked = await tx.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: { status: 'CONFIRMED', providerTxnId: paymentId, rawPayload: { zeroAmount: true } },
  });
  if (marked.count !== 1) throw new Error(`payment ${paymentId} changed under its row lock`);

  const subOrders = await tx.subOrder.findMany({
    where: { orderId: order.id },
    orderBy: { id: 'asc' },
    include: { items: { select: { variantId: true, quantity: true } } },
  });
  if (subOrders.length === 0 || subOrders.some((so) => so.status !== 'AWAITING_PAYMENT')) {
    log.error(
      { orderId: order.id, paymentId },
      'zero-amount payment confirmed but the order is inconsistent (sub-orders not payable): check manually',
    );
    return 'manual-review';
  }

  await tx.payment.updateMany({
    where: { orderId: order.id, status: 'PENDING', id: { not: paymentId } },
    data: { status: 'FAILED' },
  });
  const paid = await tx.subOrder.updateMany({
    where: { orderId: order.id, status: 'AWAITING_PAYMENT' },
    data: { status: 'PAID' },
  });
  if (paid.count !== subOrders.length) {
    throw new Error(`zero-amount confirmation: sub-orders of ${order.id} changed under the lock`);
  }
  await queueZaloStatusMessages(
    tx,
    subOrders.map((so) => so.id),
    'PAID',
    order.dbNow,
  );

  await commitStock(
    tx,
    order.id,
    subOrders.flatMap((so) => so.items),
    log,
  );

  await insertLedger(
    tx,
    subOrders.flatMap((so) => {
      const amount = subOrderPaid({
        subtotal: toMoney(so.subtotalAmount, so.currency),
        shipping: toMoney(so.shippingAmount, so.currency),
        vendorDiscount: toMoney(so.discountAmount, so.currency),
        platformDiscount: toMoney(so.platformDiscountAmount, so.currency),
      });
      return Money.isZero(amount)
        ? []
        : ledgerGroup(computeEscrowInPostings(amount), 'ESCROW_IN', order.id, so.id);
    }),
  );

  await tx.order.update({
    where: { id: order.id },
    data: { status: deriveOrderStatus(subOrders.map(() => 'PAID' as const)) },
  });
  await tx.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: ORDER_AGGREGATE_TYPE,
      aggregateId: order.id,
      eventType: 'order.paid',
      payload: OrderPaidEventSchema.parse({ orderId: order.id, customerId: order.customerId }),
    },
  });
  return 'confirmed';
}
