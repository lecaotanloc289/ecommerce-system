import type { OutboxEventType } from '@repo/core';
import type { OutboxHandler } from '../outbox/handler';
import { crmHandlers, crmSubOrderDelivered, fanOut } from './crm';
import { emailHandlers, type EmailDeps } from './notifications';
import { paymentRequestedHandler, type PaymentRequestedDeps } from './payment-requested';
import { refundRequestedHandler, type RefundRequestedDeps } from './refund-requested';

export type HandlerDeps = EmailDeps & PaymentRequestedDeps & RefundRequestedDeps;

/**
 * The dispatcher's handler table — and the single source of the event types it claims: a type
 * without an entry here is never touched (its rows wait for the handler; see CLAUDE.md "Adding a
 * handler"). Keys must be `OUTBOX_EVENT_SCHEMAS` types (typos are compile errors). One handler per
 * type: several consumers of one type are combined with `fanOut` (DB-only consumers first).
 */
export function createHandlers(deps: HandlerDeps): Partial<Record<OutboxEventType, OutboxHandler>> {
  const email = emailHandlers(deps);
  return {
    ...email,
    'sub-order.delivered': fanOut(crmSubOrderDelivered, email['sub-order.delivered']),
    ...crmHandlers(),
    'payment.requested': paymentRequestedHandler(deps),
    'refund.requested': refundRequestedHandler(deps),
  } satisfies Partial<Record<OutboxEventType, OutboxHandler>>;
}
