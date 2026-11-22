import { type SubOrderStatus, type ZaloMessageEvent, zaloEventForSubOrderStatus } from '@repo/core';
import type { Prisma } from '@repo/db';
import { monotonicFactory } from 'ulid';

// Monotonic: the vendor's message log pages by id, so rows of one call keep their creation order.
const ulid = monotonicFactory();

/** Vendors whose account may still deliver (EXPIRED can be re-scanned before the message ages out). */
const DELIVERABLE_ACCOUNT_STATUSES = ['ACTIVE', 'EXPIRED'] as const;

export interface QueueZaloMessagesInput {
  subOrderIds: readonly string[];
  event: ZaloMessageEvent;
  now: Date;
}

/**
 * Zalo-specific outbox (Golden Rule #9): call inside the transaction that changes the sub-orders.
 * Inserts one PENDING `ZaloMessage` (scheduledAt = now) per sub-order whose order opted in
 * (`Order.zaloOptIn`) and whose vendor has a ZaloAccount ACTIVE or EXPIRED — none / DISCONNECTED
 * → no row. ORDER_DELIVERED and ORDER_COMPLETED (a customer may confirm receipt straight from
 * SHIPPED) also queue AFTER_DELIVERY when the vendor's AFTER_DELIVERY template is enabled, at
 * `(deliveredAt ?? now) + delayMinutes` — at most once per sub-order (unique sub-order + event). Duplicates (same sub-order + event) are
 * skipped, so replays are safe. workers/zalo renders the template and sends at delivery time.
 */
export async function queueZaloMessages(
  tx: Prisma.TransactionClient,
  input: QueueZaloMessagesInput,
): Promise<number> {
  if (input.subOrderIds.length === 0) return 0;

  const subOrders = await tx.subOrder.findMany({
    where: {
      id: { in: [...input.subOrderIds] },
      order: { zaloOptIn: true },
      vendor: { zaloAccount: { status: { in: [...DELIVERABLE_ACCOUNT_STATUSES] } } },
    },
    select: { id: true, vendorId: true, deliveredAt: true },
    orderBy: { id: 'asc' },
  });
  if (subOrders.length === 0) return 0;

  const rows: Prisma.ZaloMessageCreateManyInput[] = subOrders.map((so) => ({
    id: ulid(),
    vendorId: so.vendorId,
    subOrderId: so.id,
    event: input.event,
    status: 'PENDING',
    scheduledAt: input.now,
    // Explicit: the column default (CURRENT_TIMESTAMP into a timestamp without time zone) follows
    // the DB session time zone, while the worker compares in UTC.
    nextAttemptAt: input.now,
  }));

  if (input.event === 'ORDER_DELIVERED' || input.event === 'ORDER_COMPLETED') {
    const careTemplates = await tx.zaloMessageTemplate.findMany({
      where: {
        vendorId: { in: [...new Set(subOrders.map((so) => so.vendorId))] },
        event: 'AFTER_DELIVERY',
        isEnabled: true,
      },
      select: { vendorId: true, delayMinutes: true },
    });
    const delayByVendor = new Map(careTemplates.map((t) => [t.vendorId, t.delayMinutes]));
    for (const so of subOrders) {
      const delayMinutes = delayByVendor.get(so.vendorId);
      if (delayMinutes === undefined) continue;
      const deliveredAt = so.deliveredAt ?? input.now;
      rows.push({
        id: ulid(),
        vendorId: so.vendorId,
        subOrderId: so.id,
        event: 'AFTER_DELIVERY',
        status: 'PENDING',
        // Never in the past (e.g. the template was enabled after delivery and the delay has
        // passed by completion): send now rather than let housekeeping age it out.
        scheduledAt: new Date(
          Math.max(deliveredAt.getTime() + delayMinutes * 60_000, input.now.getTime()),
        ),
        nextAttemptAt: input.now,
      });
    }
  }

  const created = await tx.zaloMessage.createMany({ data: rows, skipDuplicates: true });
  return created.count;
}

/**
 * Status-change convenience: queues the event `zaloEventForSubOrderStatus(status)` triggers (no-op
 * for statuses without one, e.g. AWAITING_PAYMENT). Every writer of `SubOrder.status` calls this in
 * the same transaction as the status update.
 */
export function queueZaloStatusMessages(
  tx: Prisma.TransactionClient,
  subOrderIds: readonly string[],
  status: SubOrderStatus,
  now: Date,
): Promise<number> {
  const event = zaloEventForSubOrderStatus(status);
  if (event === null) return Promise.resolve(0);
  return queueZaloMessages(tx, { subOrderIds, event, now });
}
