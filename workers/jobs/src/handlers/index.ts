import type { OutboxEventType } from '@repo/core';
import type { OutboxHandler } from '../outbox/handler';
import { emailHandlers, type EmailDeps } from './notifications';
import { paymentRequestedHandler, type PaymentRequestedDeps } from './payment-requested';

export type HandlerDeps = EmailDeps & PaymentRequestedDeps;

/**
 * The dispatcher's handler table: exactly one handler per `OUTBOX_EVENT_SCHEMAS` event type
 * (the `satisfies` makes a new core event type without a handler a compile error).
 */
export function createHandlers(deps: HandlerDeps): Record<OutboxEventType, OutboxHandler> {
  return {
    ...emailHandlers(deps),
    'payment.requested': paymentRequestedHandler(deps),
  } satisfies Record<OutboxEventType, OutboxHandler>;
}
