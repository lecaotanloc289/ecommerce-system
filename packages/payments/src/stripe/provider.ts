import { CurrencySchema, DomainError, type Currency, type Money } from '@repo/core';
import Stripe from 'stripe';
import { assertCurrency, assertPositiveAmount, single } from '../internal';
import type {
  CreateSessionInput,
  CreateSessionResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookRequest,
  WebhookResult,
} from '../types';

export interface StripeConfig {
  /** Secret API key (`sk_...`). Env: `STRIPE_SECRET_KEY`. Unused when `client` is given. */
  secretKey: string;
  /** Webhook endpoint signing secret (`whsec_...`). Env: `STRIPE_WEBHOOK_SECRET`. */
  webhookSecret: string;
  /**
   * Injected Stripe client. Tests pass `new Stripe(key, { httpClient: Stripe.createFetchHttpClient(fakeFetch) })`
   * so nothing hits the network. Default: `new Stripe(secretKey, { maxNetworkRetries: 2 })`.
   */
  client?: Stripe;
  /**
   * Currencies to accept. Default `['USD', 'VND']`. Our Money is already in Stripe's unit for both:
   * USD in cents, VND in đồng (Stripe treats VND as zero-decimal) — amounts pass through unchanged.
   */
  currencies?: readonly Currency[];
  /** Checkout Session lifetime. Stripe allows 30..1440 minutes. Default 30. */
  sessionTtlMinutes?: number;
  /** Max age of a webhook signature timestamp. Default 300 s (Stripe's default). */
  webhookToleranceSeconds?: number;
  /** Injected clock. Default: `() => new Date()`. */
  now?: () => Date;
}

const DEFAULT_CURRENCIES: readonly Currency[] = ['USD', 'VND'];
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_TOLERANCE_SECONDS = 300;

function invalidSignature(reason: string): DomainError {
  return new DomainError('payment.error.signature-invalid', { provider: 'STRIPE', reason });
}

function unavailable(error: unknown): DomainError {
  if (error instanceof Stripe.errors.StripeError) {
    return new DomainError('payment.error.provider-unavailable', {
      provider: 'STRIPE',
      reason: error.type,
      status: error.statusCode ?? 0,
    });
  }
  return new DomainError('payment.error.provider-unavailable', {
    provider: 'STRIPE',
    reason: 'unknown',
  });
}

/**
 * Stripe refused the request itself (400 invalid request, 402 card/payment error, 404 unknown
 * object): retrying the same request cannot succeed. 401/403 (key/config), 409 (conflict),
 * 429, 5xx, network and idempotency errors are treated as transient.
 */
function isFinalRejection(error: unknown): error is InstanceType<typeof Stripe.errors.StripeError> {
  return (
    error instanceof Stripe.errors.StripeError &&
    !(error instanceof Stripe.errors.StripeIdempotencyError) &&
    (error.statusCode === 400 || error.statusCode === 402 || error.statusCode === 404)
  );
}

/** Stripe amount + lower-case currency → Money; anything unexpected is an amount mismatch. */
function toMoney(amount: number | null, currency: string | null): Money {
  const parsed = CurrencySchema.safeParse(currency?.toUpperCase());
  if (amount === null || !Number.isSafeInteger(amount) || !parsed.success) {
    throw new DomainError('payment.error.amount-mismatch', {
      provider: 'STRIPE',
      received: `${String(amount)} ${String(currency)}`,
    });
  }
  return { amount, currency: parsed.data };
}

function sessionPaymentId(session: Stripe.Checkout.Session): string | undefined {
  return session.client_reference_id ?? session.metadata?.paymentId ?? undefined;
}

function sessionTxnId(session: Stripe.Checkout.Session): string {
  const pi = session.payment_intent;
  if (typeof pi === 'string') return pi;
  return pi?.id ?? session.id;
}

const REFUND_STATUS: Record<string, RefundResult['status']> = {
  succeeded: 'SUCCEEDED',
  pending: 'PENDING',
  requires_action: 'PENDING',
  failed: 'FAILED',
  canceled: 'FAILED',
};

export type StripeProvider = PaymentProvider & { readonly id: 'STRIPE' };

export function createStripeProvider(config: StripeConfig): StripeProvider {
  const stripe = config.client ?? new Stripe(config.secretKey, { maxNetworkRetries: 2 });
  const currencies = config.currencies ?? DEFAULT_CURRENCIES;
  const ttlMinutes = config.sessionTtlMinutes ?? DEFAULT_TTL_MINUTES;
  const tolerance = config.webhookToleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = config.now ?? (() => new Date());

  async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    assertCurrency('STRIPE', currencies, input.amount);
    assertPositiveAmount(input.amount);
    const expiresAt = Math.floor(now().getTime() / 1000) + ttlMinutes * 60;
    const metadata = { paymentId: input.paymentId, orderId: input.orderId };

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: input.paymentId,
          metadata,
          // Copied onto the PaymentIntent so it can be traced back from the Stripe dashboard.
          payment_intent_data: { metadata },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.amount.currency.toLowerCase(),
                unit_amount: input.amount.amount,
                product_data: { name: input.description.trim() || `Order ${input.orderId}` },
              },
            },
          ],
          success_url: input.returnUrl,
          cancel_url: input.returnUrl,
          locale: input.locale === 'VI' ? 'vi' : 'en',
          expires_at: expiresAt,
        },
        // No explicit idempotency key: `expires_at` changes on every worker retry, and Stripe
        // rejects a reused key with different params. stripe-node still adds its own key to its
        // internal network retries. A session orphaned by a lost response is harmless: nobody
        // has its URL, and it expires.
      );
    } catch (error) {
      if (isFinalRejection(error)) {
        // Stripe will never accept this request (e.g. amount below its minimum): don't retry.
        throw new DomainError('common.error.validation-failed', {
          provider: 'STRIPE',
          reason: error.type,
          code: error.code ?? '',
        });
      }
      throw unavailable(error);
    }
    if (!session.url) {
      throw new DomainError('payment.error.provider-unavailable', {
        provider: 'STRIPE',
        reason: 'missing-session-url',
      });
    }
    return {
      redirectUrl: session.url,
      providerRef: session.id,
      expiresAt: new Date(session.expires_at * 1000),
    };
  }

  function verifyWebhook(req: WebhookRequest): WebhookResult {
    const header = single(req.headers['stripe-signature']);
    if (header === undefined || header === '') throw invalidSignature('missing-header');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, header, config.webhookSecret, tolerance);
    } catch (error) {
      // Signature mismatch, stale timestamp (tolerance) or unparseable body. Never log the payload.
      throw invalidSignature(error instanceof Stripe.errors.StripeError ? error.type : 'invalid');
    }
    const ignored: WebhookResult = { status: 'IGNORED', eventType: event.type, raw: event };

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const paymentId = sessionPaymentId(session);
        // `unpaid` = delayed payment method still settling; its async_payment_* event follows.
        if (paymentId === undefined || session.payment_status !== 'paid') return ignored;
        return {
          status: 'CONFIRMED',
          paymentId,
          providerTxnId: sessionTxnId(session),
          amount: toMoney(session.amount_total, session.currency),
          raw: event,
        };
      }
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        const paymentId = sessionPaymentId(session);
        if (paymentId === undefined) return ignored;
        return {
          status: 'FAILED',
          paymentId,
          providerTxnId: sessionTxnId(session),
          amount: toMoney(session.amount_total, session.currency),
          raw: event,
        };
      }
      default:
        // Includes `payment_intent.payment_failed`: a declined card is NOT terminal for a Checkout
        // Session — the customer can retry in the same session until it expires — so the
        // terminal failure signal is `checkout.session.expired` / `async_payment_failed`.
        return ignored;
    }
  }

  async function refund(input: RefundInput): Promise<RefundResult> {
    assertCurrency('STRIPE', currencies, input.amount);
    assertPositiveAmount(input.amount);
    if (
      input.paymentAmount.currency !== input.amount.currency ||
      input.amount.amount > input.paymentAmount.amount
    ) {
      throw new DomainError('payment.error.amount-mismatch', {
        provider: 'STRIPE',
        refund: input.amount.amount,
        paid: input.paymentAmount.amount,
      });
    }

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: input.providerTxnId,
          amount: input.amount.amount,
          metadata: {
            refundId: input.refundId,
            paymentId: input.paymentId,
            initiatedBy: input.initiatedBy,
            reason: input.reason.slice(0, 500),
          },
        },
        { idempotencyKey: `refund:${input.refundId}` },
      );
    } catch (error) {
      // Stripe refused this refund (already refunded, unknown intent, ...): final.
      if (isFinalRejection(error)) {
        return {
          providerRefundId: null,
          status: 'FAILED',
          failureCode: error.code ?? error.type,
          raw: { type: error.type, code: error.code ?? null, statusCode: error.statusCode ?? null },
        };
      }
      throw unavailable(error);
    }
    const status = REFUND_STATUS[refund.status ?? ''] ?? 'PENDING';
    return {
      providerRefundId: refund.id,
      status,
      failureCode: status === 'SUCCEEDED' ? null : (refund.failure_reason ?? refund.status),
      raw: refund,
    };
  }

  return { id: 'STRIPE', currencies, createSession, verifyWebhook, refund };
}
