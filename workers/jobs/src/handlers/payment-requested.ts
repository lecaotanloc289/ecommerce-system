import { DomainError, OUTBOX_EVENT_SCHEMAS, type ErrorCode } from '@repo/core';
import { toMoney } from '@repo/db';
import { createTranslator, fromCoreLocale } from '@repo/i18n';
import { PermanentError } from '../outbox/errors';
import { defineHandler } from '../outbox/handler';
import type { Providers } from '../payments/providers';

export interface PaymentRequestedDeps {
  providers: Providers;
  /** Storefront origin: Stripe returns to `{WEB_ORIGIN}/{locale}/order/success?orderId=`. */
  webOrigin: string;
  /** Public API origin: VNPay returns to `{API_PUBLIC_URL}/v1/payments/return/vnpay`. */
  apiPublicUrl: string;
}

/** Provider errors that a retry cannot fix (see packages/payments/CLAUDE.md). */
const PERMANENT_PROVIDER_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'common.error.validation-failed',
  'money.error.currency-mismatch',
  'money.error.invalid-operand',
  'payment.error.amount-mismatch',
]);

/** Used when the Payment predates `client_ip` (VNPay requires some address). */
const FALLBACK_CLIENT_IP = '127.0.0.1';

/**
 * `payment.requested` (roadmap D2): create the provider session for a PENDING attempt and store
 * `redirectUrl` / `expiresAt` / `providerRef` — only `WHERE status = 'PENDING'`, since a retry or a
 * cancel may fail the attempt while the provider call is in flight.
 *
 * Idempotent: an attempt that is no longer PENDING, or already has a session, is a no-op. A crash
 * between `createSession` and commit re-creates the session on redelivery; the orphaned one is never
 * shown to anyone and expires at the provider.
 *
 * Zero amount (free order): no provider session (providers reject 0). Logged and marked processed
 * for now — T3.2 replaces this branch with the zero-amount confirmation (see workers/jobs/CLAUDE.md).
 */
export function paymentRequestedHandler(deps: PaymentRequestedDeps) {
  return defineHandler(OUTBOX_EVENT_SCHEMAS['payment.requested'], async (event, ctx) => {
    const payment = await ctx.tx.payment.findUnique({
      where: { id: event.paymentId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        status: true,
        amount: true,
        currency: true,
        clientIp: true,
        redirectUrl: true,
        order: { select: { customer: { select: { primaryLocale: true } } } },
      },
    });
    if (!payment || payment.orderId !== event.orderId) {
      throw new PermanentError(`payment ${event.paymentId} of order ${event.orderId} not found`);
    }
    const log = ctx.log.child({ orderId: payment.orderId, paymentId: payment.id });
    if (payment.status !== 'PENDING') {
      log.info({ status: payment.status }, 'payment no longer PENDING; session not created');
      return;
    }
    if (payment.redirectUrl !== null) {
      log.info('payment already has a session');
      return;
    }
    if (payment.amount === 0n) {
      log.info('zero-amount payment; no provider session (confirmation not implemented yet, T3.2)');
      return;
    }

    // The row's provider is authoritative (the payload's is informational).
    const provider = deps.providers[payment.provider];
    if (!provider) {
      throw new PermanentError(`payment provider ${payment.provider} is not configured`);
    }

    const locale = fromCoreLocale(payment.order.customer.primaryLocale);
    const returnUrl =
      payment.provider === 'VNPAY'
        ? new URL('/v1/payments/return/vnpay', deps.apiPublicUrl).toString()
        : stripeReturnUrl(deps.webOrigin, locale, payment.orderId);

    const session = await provider
      .createSession({
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: toMoney(payment.amount, payment.currency),
        returnUrl,
        ipAddr: payment.clientIp ?? FALLBACK_CLIENT_IP,
        locale: payment.order.customer.primaryLocale,
        description: createTranslator(locale)('paymentSession.description', {
          orderId: payment.orderId,
        }),
      })
      .catch((error: unknown) => {
        if (error instanceof DomainError && PERMANENT_PROVIDER_ERRORS.has(error.code)) {
          throw new PermanentError(`${payment.provider} refused the session: ${error.code}`, {
            cause: error,
          });
        }
        throw error; // payment.error.provider-unavailable and anything unexpected: retry
      });

    const updated = await ctx.tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        redirectUrl: session.redirectUrl,
        expiresAt: session.expiresAt,
        providerRef: session.providerRef,
      },
    });
    if (updated.count === 0) {
      log.info('payment left PENDING while the session was created; session discarded');
      return;
    }
    log.info(
      { provider: payment.provider, expiresAt: session.expiresAt },
      'payment session created',
    );
  });
}

function stripeReturnUrl(webOrigin: string, locale: string, orderId: string): string {
  const url = new URL(`/${locale}/order/success`, webOrigin);
  url.searchParams.set('orderId', orderId);
  return url.toString();
}
