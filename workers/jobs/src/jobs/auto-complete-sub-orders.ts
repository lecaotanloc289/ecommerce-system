import {
  assertTransition,
  deriveOrderStatus,
  ORDER_AGGREGATE_TYPE,
  SubOrderCompletedEventSchema,
} from '@repo/core';
import { prisma } from '@repo/db';
import { ulid } from 'ulid';
import { loadTunables, lockOrder, subOrderStatuses } from '../domain/orders';
import type { Tx } from '../outbox/handler';
import { forEachCandidate, JOB_TX_OPTIONS, type ItemOutcome, type JobContext } from './run';

interface Candidate {
  id: string;
  orderId: string;
}

/**
 * `auto-complete-sub-orders`: DELIVERED sub-orders whose refund window has passed
 * (`deliveredAt + refundWindowDays <= now`, DB clock) → COMPLETED, one transaction each. The
 * payout hold (`release-payouts`) starts at `completedAt`.
 */
export async function autoCompleteSubOrders(ctx: JobContext) {
  const { refundWindowDays } = await loadTunables();
  return forEachCandidate<Candidate>(
    ctx,
    (afterId, limit) => prisma.$queryRaw<Candidate[]>`
      SELECT id, order_id AS "orderId" FROM sub_orders
      WHERE status = 'DELIVERED'
        AND delivered_at + make_interval(days => ${refundWindowDays}::int)
            <= (now() AT TIME ZONE 'UTC')
        AND id > ${afterId}
      ORDER BY id
      LIMIT ${limit}::int`,
    (so) => prisma.$transaction((tx) => completeSubOrder(tx, so, refundWindowDays), JOB_TX_OPTIONS),
  );
}

/**
 * Mirror of the API's `transitionSubOrder(tx, ref, { to: 'COMPLETED', actor: 'SYSTEM' })`
 * (server `src/orders/sub-order-transition.ts`): lock the order row first → re-read the status
 * (and the window, DB clock) under the lock → `assertTransition('DELIVERED', 'COMPLETED',
 * 'SYSTEM')` → `UPDATE … WHERE id AND status = 'DELIVERED'` + `completedAt` → `orders.status =
 * deriveOrderStatus(...)` → outbox `sub-order.completed {orderId, subOrderId, vendorId}`.
 * A customer confirm / refund that won the lock makes it `skipped` (no 409 here: nothing to do).
 */
export async function completeSubOrder(
  tx: Tx,
  ref: Candidate,
  refundWindowDays: number,
): Promise<ItemOutcome> {
  const order = await lockOrder(tx, ref.orderId);
  if (!order) return 'skipped';
  const [current] = await tx.$queryRaw<{ vendorId: string; status: string; due: boolean }[]>`
    SELECT vendor_id AS "vendorId", status::text AS status,
           (delivered_at + make_interval(days => ${refundWindowDays}::int)
             <= (now() AT TIME ZONE 'UTC')) AS due
    FROM sub_orders WHERE id = ${ref.id} AND order_id = ${ref.orderId}`;
  if (!current || current.status !== 'DELIVERED' || !current.due) return 'skipped';
  assertTransition('DELIVERED', 'COMPLETED', 'SYSTEM');

  const { count } = await tx.subOrder.updateMany({
    where: { id: ref.id, status: 'DELIVERED' },
    data: { status: 'COMPLETED', completedAt: order.dbNow },
  });
  if (count === 0) return 'skipped';

  await tx.order.update({
    where: { id: ref.orderId },
    data: { status: deriveOrderStatus(await subOrderStatuses(tx, ref.orderId)) },
  });
  await tx.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: ORDER_AGGREGATE_TYPE,
      aggregateId: ref.orderId,
      eventType: 'sub-order.completed',
      payload: SubOrderCompletedEventSchema.parse({
        orderId: ref.orderId,
        subOrderId: ref.id,
        vendorId: current.vendorId,
      }),
    },
  });
  return 'done';
}
