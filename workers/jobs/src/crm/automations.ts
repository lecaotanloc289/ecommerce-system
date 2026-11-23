import { messageKindOf, type CrmAutomationKind } from '@repo/core';
import type { CrmChannel } from '@repo/db';
import { ulid } from 'ulid';
import { PermanentError } from '../outbox/errors';
import type { Tx } from '../outbox/handler';

const MS_PER_DAY = 86_400_000;

/** Every CRM message is offered on both channels; email is dropped at send time without an address. */
export const CRM_CHANNELS: CrmChannel[] = ['IN_APP', 'EMAIL'];

export type CrmTrigger = 'delivered' | 'completed';

/**
 * Automations a trigger may schedule (C8). `completed` also covers THANK_YOU / REVIEW_REQUEST, but
 * only for a sub-order that never went through DELIVERED (confirm-received straight from SHIPPED
 * emits no `sub-order.delivered`; the API then sets `deliveredAt = completedAt`). A sub-order that
 * was delivered had its chance on `sub-order.delivered`: an automation enabled later must not send
 * days-old "thank you" / review mail when the order auto-completes.
 */
const KINDS: Record<CrmTrigger, CrmAutomationKind[]> = {
  delivered: ['THANK_YOU', 'REVIEW_REQUEST'],
  completed: ['THANK_YOU', 'REVIEW_REQUEST', 'REORDER_REMINDER'],
};

/**
 * Inserts one SCHEDULED `crm_messages` row per enabled automation of the sub-order's vendor that
 * `trigger` starts (C8/C9): `scheduledFor` = trigger time + `delayDays` (THANK_YOU / REVIEW_REQUEST
 * from `deliveredAt`, falling back to `completedAt`; REORDER_REMINDER from `completedAt`). Re-reads
 * the sub-order (the payload carries ids only); a sub-order no longer DELIVERED / COMPLETED
 * (refunded meanwhile) schedules nothing. Idempotent: `createMany({ skipDuplicates })` on the unique
 * `(automation_kind, sub_order_id)`. Everything else (vendor ACTIVE, consent, automation still on,
 * review / reorder) is re-checked when the message is due. Returns the number of rows inserted.
 */
export async function scheduleAutomationMessages(
  tx: Tx,
  subOrderId: string,
  trigger: CrmTrigger,
): Promise<number> {
  const subOrder = await tx.subOrder.findUnique({
    where: { id: subOrderId },
    select: {
      vendorId: true,
      status: true,
      deliveredAt: true,
      completedAt: true,
      order: { select: { customerId: true } },
    },
  });
  if (!subOrder) throw new PermanentError(`sub-order ${subOrderId} not found`);
  if (subOrder.status !== 'DELIVERED' && subOrder.status !== 'COMPLETED') return 0;

  const neverDelivered =
    subOrder.deliveredAt === null ||
    (subOrder.completedAt !== null &&
      subOrder.deliveredAt.getTime() === subOrder.completedAt.getTime());
  const kinds = KINDS[trigger].filter(
    (kind) => trigger === 'delivered' || kind === 'REORDER_REMINDER' || neverDelivered,
  );
  const automations = await tx.crmAutomation.findMany({
    where: { vendorId: subOrder.vendorId, isEnabled: true, kind: { in: kinds } },
    select: { kind: true, delayDays: true },
  });
  const rows = automations.flatMap((automation) => {
    const base =
      automation.kind === 'REORDER_REMINDER'
        ? subOrder.completedAt
        : (subOrder.deliveredAt ?? subOrder.completedAt);
    if (base === null) return [];
    return [
      {
        id: ulid(),
        vendorId: subOrder.vendorId,
        userId: subOrder.order.customerId,
        kind: messageKindOf(automation.kind),
        automationKind: automation.kind,
        subOrderId,
        channels: CRM_CHANNELS,
        scheduledFor: new Date(base.getTime() + automation.delayDays * MS_PER_DAY),
      },
    ];
  });
  if (rows.length === 0) return 0;
  const { count } = await tx.crmMessage.createMany({ data: rows, skipDuplicates: true });
  return count;
}
