// PaymentProvider interface + VNPay / Stripe adapters (see CLAUDE.md).
// Pure logic: no DB, no env reads — config comes in through the factory params; HTTP (`fetch`)
// and the Stripe client are injectable. Adding a provider = new adapter implementing
// `PaymentProvider`; no business-logic changes.
export type {
  CreateSessionInput,
  CreateSessionResult,
  FetchLike,
  PaymentProvider,
  RefundInput,
  RefundOutcome,
  RefundResult,
  WebhookIgnoredResult,
  WebhookPaymentResult,
  WebhookRequest,
  WebhookResult,
} from './types';
export * from './vnpay';
export * from './stripe';
