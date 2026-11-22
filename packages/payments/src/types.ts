import type { Currency, Locale, Money, PaymentProvider as PaymentProviderId } from '@repo/core';

/** Input to `createSession` — built by the worker from the `Payment` row (roadmap D2). */
export interface CreateSessionInput {
  /** `Payment.id` (ULID). Becomes VNPay `vnp_TxnRef` / Stripe `client_reference_id`. */
  paymentId: string;
  /** `Order.id`, carried as metadata for support/reconciliation. */
  orderId: string;
  /** Amount to charge, integer minor units. Must equal `Payment.amount` + `Payment.currency`. */
  amount: Money;
  /** Where the provider sends the browser back after paying (or cancelling). */
  returnUrl: string;
  /** Customer IP (VNPay `vnp_IpAddr`, required by VNPay; ignored by Stripe). */
  ipAddr: string;
  /** UI language of the hosted payment page. */
  locale: Locale;
  /** Short human description (order number). VNPay strips diacritics/special characters. */
  description: string;
}

export interface CreateSessionResult {
  /** Hosted payment page URL the client redirects to (`Payment.redirectUrl`). */
  redirectUrl: string;
  /**
   * Provider-side reference that later calls need — persist it with the Payment.
   * VNPay: the pay request's `vnp_CreateDate` (`yyyyMMddHHmmss`, GMT+7) — `refund` needs it as
   * `vnp_TransactionDate`. Stripe: the Checkout Session id (`cs_...`).
   */
  providerRef: string;
  /** When the hosted session stops accepting payment (`Payment.expiresAt`). */
  expiresAt: Date;
}

/** HTTP request as the server's webhook route received it. */
export interface WebhookRequest {
  /** Lower-cased header names, as Node/Fastify expose them. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Exact bytes of the request body (Stripe signs these). Empty for VNPay (GET). */
  rawBody: string | Uint8Array;
  /** Parsed query string (VNPay IPN / return URL). */
  query: Readonly<Record<string, string | string[] | undefined>>;
}

/** A verified payment outcome. The server compares `paymentId` + `amount` against the DB. */
export interface WebhookPaymentResult {
  status: 'CONFIRMED' | 'FAILED';
  paymentId: string;
  /** VNPay `vnp_TransactionNo` / Stripe PaymentIntent id (session id if none). Store as `Payment.providerTxnId`. */
  providerTxnId: string;
  /** Amount the provider reports, converted back to integer minor units. */
  amount: Money;
  /** Verified provider payload, for `Payment.rawPayload`. */
  raw: unknown;
}

/** Authentic event that does not change a Payment (e.g. other Stripe event types). Reply 2xx and drop it. */
export interface WebhookIgnoredResult {
  status: 'IGNORED';
  /** Provider event type, for logs. */
  eventType: string;
  raw: unknown;
}

export type WebhookResult = WebhookPaymentResult | WebhookIgnoredResult;

/** Full or partial refund of a confirmed payment (roadmap D12: one whole sub-order). */
export interface RefundInput {
  /** `Refund.id` (ULID). Used as the provider idempotency/request id. */
  refundId: string;
  /** `Payment.id` (= VNPay `vnp_TxnRef`). */
  paymentId: string;
  /** `Payment.providerTxnId` from the confirming webhook. */
  providerTxnId: string;
  /** `CreateSessionResult.providerRef` of that payment (VNPay requires it; Stripe ignores it). */
  providerRef: string | null;
  /** Amount to refund (≤ `paymentAmount`, same currency). */
  amount: Money;
  /** Amount originally captured — decides full vs partial refund. */
  paymentAmount: Money;
  /** Free-text reason (admin input). */
  reason: string;
  /** Who initiated the refund (VNPay `vnp_CreateBy`), e.g. the admin user id. */
  initiatedBy: string;
}

/**
 * - `SUCCEEDED` — the provider accepted and completed (or irrevocably accepted) the refund.
 * - `PENDING`   — accepted but still in flight / already requested earlier; reconcile later.
 * - `FAILED`    — the provider refused it (see `failureCode`); retrying the same request won't help.
 * Transient failures (network, 5xx) are thrown as `payment.error.provider-unavailable` instead, so
 * the worker retries with backoff.
 */
export type RefundOutcome = 'SUCCEEDED' | 'PENDING' | 'FAILED';

export interface RefundResult {
  providerRefundId: string | null;
  status: RefundOutcome;
  /** Provider response code / Stripe failure reason when not SUCCEEDED. */
  failureCode: string | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  /** Currencies this adapter (as configured) can charge. */
  readonly currencies: readonly Currency[];
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  /** Verifies authenticity (throws `payment.error.signature-invalid`) and maps the outcome. Synchronous, no I/O. */
  verifyWebhook(req: WebhookRequest): WebhookResult;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Subset of the WHATWG `fetch` the adapters use — inject a fake in tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
