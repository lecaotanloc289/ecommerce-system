import {
  assertTransition,
  deriveOrderStatus,
  DomainError,
  ORDER_AGGREGATE_TYPE,
  type OutboxEventType,
  SubOrderCompletedEventSchema,
  SubOrderDeliveredEventSchema,
  SubOrderShippedEventSchema,
  type SubOrderActor,
  type SubOrderShip,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';
import { assertVendorActive } from '../vendor/vendor-scope';

/** Fulfilment moves (D11) done through this helper; payment/cancel/refund have their own writers. */
export type FulfilmentTarget =
  | { to: 'PROCESSING'; actor: 'VENDOR' }
  | { to: 'SHIPPED'; actor: 'VENDOR'; ship: SubOrderShip }
  | { to: 'DELIVERED'; actor: 'VENDOR' }
  | { to: 'COMPLETED'; actor: Extract<SubOrderActor, 'CUSTOMER' | 'SYSTEM'> };

export interface SubOrderRef {
  subOrderId: string;
  orderId: string;
  vendorId: string;
  customerId: string;
}

/**
 * Moves one sub-order along the fulfilment lifecycle, inside the caller's transaction. Contract
 * (same as checkout / cancel / payment confirmation, so writers serialise on the order row):
 *
 * 1. `SELECT … FROM orders WHERE id = $1 FOR UPDATE` — the ORDER row is always locked first.
 * 2. VENDOR moves re-check `vendors.status = ACTIVE` (`FOR SHARE`; a stale JWT cannot bypass it).
 * 3. Re-read the sub-order status under the lock and check the state machine
 *    (`assertTransition`, else 409 `order.error.invalid-status-transition`).
 * 4. Conditional `UPDATE … WHERE id = $1 AND status = <from>` + timestamps; 0 rows → 409.
 * 5. `orders.status` = `deriveOrderStatus(all sub-orders)`.
 * 6. Outbox `sub-order.shipped` / `.delivered` / `.completed` (PROCESSING emits nothing).
 *
 * Ownership/scope is the caller's job: `ref` must come from a lookup scoped by the vendor (JWT)
 * or the customer (JWT).
 */
export async function transitionSubOrder(
  tx: Prisma.TransactionClient,
  ref: SubOrderRef,
  target: FulfilmentTarget,
  now: Date = new Date(),
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders WHERE id = ${ref.orderId} FOR UPDATE`;
  if (locked.length === 0) throw new DomainError('order.error.not-found');

  if (target.actor === 'VENDOR') await assertVendorActive(tx, ref.vendorId);

  const current = await tx.subOrder.findUnique({
    where: { id: ref.subOrderId },
    select: { status: true, deliveredAt: true },
  });
  if (!current) throw new DomainError('sub-order.error.not-found');
  const from = current.status;
  assertTransition(from, target.to, target.actor);

  const { count } = await tx.subOrder.updateMany({
    where: { id: ref.subOrderId, status: from },
    data: { status: target.to, ...timestamps(target, current.deliveredAt, now) },
  });
  if (count === 0) {
    throw new DomainError('order.error.invalid-status-transition', { from, to: target.to });
  }

  const statuses = await tx.subOrder.findMany({
    where: { orderId: ref.orderId },
    select: { status: true },
  });
  await tx.order.update({
    where: { id: ref.orderId },
    data: { status: deriveOrderStatus(statuses.map((s) => s.status)) },
  });

  const event = outboxEvent(ref, target.to);
  if (event) {
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        aggregateType: ORDER_AGGREGATE_TYPE,
        aggregateId: ref.orderId,
        eventType: event.type,
        payload: event.payload,
      },
    });
  }
}

function timestamps(
  target: FulfilmentTarget,
  deliveredAt: Date | null,
  now: Date,
): Prisma.SubOrderUpdateManyMutationInput {
  switch (target.to) {
    case 'PROCESSING':
      return {};
    case 'SHIPPED':
      return {
        carrier: target.ship.carrier,
        trackingNumber: target.ship.trackingNumber,
        shippedAt: now,
      };
    case 'DELIVERED':
      return { deliveredAt: now };
    case 'COMPLETED':
      // Confirm-received straight from SHIPPED: the parcel arrived no later than now.
      return { deliveredAt: deliveredAt ?? now, completedAt: now };
  }
}

function outboxEvent(
  ref: SubOrderRef,
  to: FulfilmentTarget['to'],
): { type: OutboxEventType; payload: Record<string, string> } | null {
  const ids = { orderId: ref.orderId, subOrderId: ref.subOrderId };
  switch (to) {
    case 'PROCESSING':
      return null;
    case 'SHIPPED':
      return {
        type: 'sub-order.shipped',
        payload: SubOrderShippedEventSchema.parse({ ...ids, customerId: ref.customerId }),
      };
    case 'DELIVERED':
      return {
        type: 'sub-order.delivered',
        payload: SubOrderDeliveredEventSchema.parse({ ...ids, customerId: ref.customerId }),
      };
    case 'COMPLETED':
      return {
        type: 'sub-order.completed',
        payload: SubOrderCompletedEventSchema.parse({ ...ids, vendorId: ref.vendorId }),
      };
  }
}
