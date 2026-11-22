import type { OutboxEventType } from '@repo/core';
import type { OutboxHandler } from '../outbox/handler';
import { emailHandlers, type EmailDeps } from './notifications';
import { paymentRequestedHandler, type PaymentRequestedDeps } from './payment-requested';

export type HandlerDeps = EmailDeps & PaymentRequestedDeps;

/**
 * The dispatcher's handler table — and the single source of the event types it claims: a type
 * without an entry here is never touched (its rows wait for the handler; see CLAUDE.md "Adding a
 * handler"). Keys must be `OUTBOX_EVENT_SCHEMAS` types (typos are compile errors).
 */
export function createHandlers(deps: HandlerDeps): Partial<Record<OutboxEventType, OutboxHandler>> {
  return {
    ...emailHandlers(deps),
    'payment.requested': paymentRequestedHandler(deps),
  } satisfies Partial<Record<OutboxEventType, OutboxHandler>>;
}
