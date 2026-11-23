import { OUTBOX_EVENT_SCHEMAS } from '@repo/core';
import { scheduleAutomationMessages } from '../crm/automations';
import { startCampaign } from '../crm/campaigns';
import { PermanentError } from '../outbox/errors';
import { defineHandler, type HandlerContext, type OutboxHandler } from '../outbox/handler';

/**
 * CRM consumer of `sub-order.delivered`: schedules THANK_YOU / REVIEW_REQUEST. Not registered on its
 * own — the event already has the customer email handler, and the dispatcher allows one handler per
 * type, so `createHandlers` fans out to both (`fanOut`).
 */
export const crmSubOrderDelivered = defineHandler(
  OUTBOX_EVENT_SCHEMAS['sub-order.delivered'],
  async (event, ctx) => {
    const scheduled = await scheduleAutomationMessages(ctx.tx, event.subOrderId, 'delivered');
    if (scheduled > 0)
      ctx.log.info({ subOrderId: event.subOrderId, scheduled }, 'crm messages scheduled');
  },
);

/** CRM handlers that own their event type outright. */
export function crmHandlers() {
  return {
    /**
     * Schedules REORDER_REMINDER (+ THANK_YOU / REVIEW_REQUEST when the customer confirmed receipt
     * straight from SHIPPED and no `sub-order.delivered` came). The payload's `vendorId` must match.
     */
    'sub-order.completed': defineHandler(
      OUTBOX_EVENT_SCHEMAS['sub-order.completed'],
      async (event, ctx) => {
        const subOrder = await ctx.tx.subOrder.findUnique({
          where: { id: event.subOrderId },
          select: { orderId: true, vendorId: true },
        });
        if (
          !subOrder ||
          subOrder.orderId !== event.orderId ||
          subOrder.vendorId !== event.vendorId
        ) {
          throw new PermanentError(`sub-order ${event.subOrderId} not found`);
        }
        const scheduled = await scheduleAutomationMessages(ctx.tx, event.subOrderId, 'completed');
        if (scheduled > 0) {
          ctx.log.info({ subOrderId: event.subOrderId, scheduled }, 'crm messages scheduled');
        }
      },
    ),

    /**
     * Starts the campaign when due (`startCampaign`). The API sets the row's `next_attempt_at` to the
     * send time, so this normally runs on time; if it is not due (or no longer SCHEDULED) nothing
     * happens and the `crm-start-campaigns` job remains the backstop.
     */
    'crm.campaign.scheduled': defineHandler(
      OUTBOX_EVENT_SCHEMAS['crm.campaign.scheduled'],
      async (event, ctx) => {
        const campaign = await ctx.tx.crmCampaign.findUnique({
          where: { id: event.campaignId },
          select: { vendorId: true },
        });
        if (!campaign || campaign.vendorId !== event.vendorId) {
          throw new PermanentError(`crm campaign ${event.campaignId} not found`);
        }
        const result = await startCampaign(ctx.tx, event.campaignId, ctx.log);
        ctx.log.info({ campaignId: event.campaignId, ...result }, 'crm.campaign.scheduled handled');
      },
    ),
  } satisfies Record<string, OutboxHandler>;
}

/**
 * Runs several handlers of the same event type one after another in the event's transaction (the
 * dispatcher's one-handler-per-type rule). Put DB-only consumers first and those with external side
 * effects (email) last: if a later one throws, the whole event rolls back and is retried, so earlier
 * consumers must be idempotent (they are: inserts use `skipDuplicates`).
 */
export function fanOut(...handlers: OutboxHandler[]): OutboxHandler {
  const secretKeys = handlers.flatMap((h) => h.secretKeys ?? []);
  return {
    ...(secretKeys.length > 0 ? { secretKeys } : {}),
    async handle(payload: unknown, ctx: HandlerContext) {
      for (const handler of handlers) await handler.handle(payload, ctx);
    },
  };
}
