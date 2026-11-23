import { DomainError, OUTBOX_EVENT_SCHEMAS } from '@repo/core';
import { toMoney } from '@repo/db';
import { lockOrder } from '../domain/orders';
import { PermanentError } from '../outbox/errors';
import { defineHandler, type Tx } from '../outbox/handler';
import { PERMANENT_PROVIDER_ERRORS } from '../payments/provider-errors';
import type { Providers } from '../payments/providers';

export interface RefundRequestedDeps {
  providers: Providers;
}

/**
 * `refund.requested {refundId, orderId, subOrderId}` (T3.5 admin refund, or the API's late-payment
 * refund) — server CLAUDE.md "Refunds → Contract for the worker". The ledger, sub-order status and
 * stock were already written by the API; this handler only moves the money at the provider and
 * records the outcome on the `Refund` row:
 *
 * - Refund not PENDING, or PENDING with a `providerRefundId` (the provider answered PENDING
 *   before) → no-op (idempotent redelivery; no second provider call).
 * - `provider.refund({ refundId (= idempotency id), paymentId, providerTxnId, providerRef,
 *   amount, paymentAmount, reason, initiatedBy })` — before any lock: the order row is not held
 *   during the external call.
 * - SUCCEEDED → lock the order row, Refund SUCCEEDED + `providerRefundId` `WHERE status =
 *   'PENDING'`; then Payment CONFIRMED → REFUNDED once every sub-order of the order is REFUNDED /
 *   CANCELLED and the SUCCEEDED refunds of the payment cover its amount (the order lock makes
 *   sibling refunds see each other's result).
 * - FAILED → Refund FAILED (+ `providerRefundId` if any), error log = ops alert. Ledger untouched:
 *   the customer is still owed the money; a retry is a NEW Refund row + event (API side).
 * - PENDING (async at the provider) → stays PENDING, `providerRefundId` stored, warn log.
 *   Reconciliation is manual for now (VNPay `querydr` / Stripe `refund.updated` not wired).
 * - `payment.error.provider-unavailable` / unknown errors → retry with backoff; validation-type
 *   errors, a payment without `providerTxnId`, or an unconfigured provider → dead-letter.
 */
export function refundRequestedHandler(deps: RefundRequestedDeps) {
  return defineHandler(OUTBOX_EVENT_SCHEMAS['refund.requested'], async (event, ctx) => {
    const refund = await ctx.tx.refund.findUnique({
      where: { id: event.refundId },
      select: {
        id: true,
        subOrderId: true,
        status: true,
        amount: true,
        currency: true,
        reason: true,
        providerRefundId: true,
        requestedById: true,
        subOrder: { select: { orderId: true } },
        payment: {
          select: {
            id: true,
            orderId: true,
            provider: true,
            amount: true,
            currency: true,
            providerTxnId: true,
            providerRef: true,
          },
        },
      },
    });
    if (
      !refund ||
      refund.subOrderId !== event.subOrderId ||
      refund.subOrder.orderId !== event.orderId
    ) {
      throw new PermanentError(
        `refund ${event.refundId} of sub-order ${event.subOrderId} not found`,
      );
    }
    const log = ctx.log.child({
      refundId: refund.id,
      orderId: event.orderId,
      subOrderId: refund.subOrderId,
      paymentId: refund.payment.id,
    });
    if (refund.status !== 'PENDING') {
      log.info({ status: refund.status }, 'refund no longer PENDING; provider not called');
      return;
    }
    if (refund.providerRefundId !== null) {
      log.info('refund already in flight at the provider; reconcile manually');
      return;
    }

    const payment = refund.payment;
    if (payment.providerTxnId === null) {
      throw new PermanentError(`payment ${payment.id} has no provider transaction to refund`);
    }
    const provider = deps.providers[payment.provider];
    if (!provider) {
      throw new PermanentError(`payment provider ${payment.provider} is not configured`);
    }

    const result = await provider
      .refund({
        refundId: refund.id,
        paymentId: payment.id,
        providerTxnId: payment.providerTxnId,
        providerRef: payment.providerRef,
        amount: toMoney(refund.amount, refund.currency),
        paymentAmount: toMoney(payment.amount, payment.currency),
        reason: refund.reason,
        initiatedBy: refund.requestedById,
      })
      .catch((error: unknown) => {
        if (error instanceof DomainError && PERMANENT_PROVIDER_ERRORS.has(error.code)) {
          throw new PermanentError(`${payment.provider} refused the refund: ${error.code}`, {
            cause: error,
          });
        }
        throw error; // payment.error.provider-unavailable and anything unexpected: retry
      });

    const providerRefundId =
      result.providerRefundId !== null ? { providerRefundId: result.providerRefundId } : {};

    if (result.status === 'PENDING') {
      if (result.providerRefundId === null) {
        // No provider reference: typically VNPay answering a duplicate request id (code 94) —
        // e.g. a redelivery after the first call's commit was lost. The money may already be
        // back with the customer; only a human can tell (VNPay portal / querydr).
        log.error(
          { provider: payment.provider, failureCode: result.failureCode },
          'refund PENDING without a provider reference (possible duplicate request); reconcile manually',
        );
        return;
      }
      await ctx.tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: { providerRefundId: result.providerRefundId },
      });
      log.warn(
        { provider: payment.provider },
        'refund accepted but still pending at the provider; reconcile manually',
      );
      return;
    }

    if (result.status === 'FAILED') {
      await ctx.tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: { status: 'FAILED', ...providerRefundId },
      });
      // Alert: the customer is owed the money (the ledger already moved it to CUSTOMER).
      log.error(
        { provider: payment.provider, failureCode: result.failureCode },
        'provider refused the refund; Refund FAILED — refund manually or request a new one',
      );
      return;
    }

    // SUCCEEDED. Lock the order (first lock of every order writer) so the "whole payment
    // refunded?" check below sees sibling refunds that committed before us.
    await lockOrder(ctx.tx, event.orderId);
    const updated = await ctx.tx.refund.updateMany({
      where: { id: refund.id, status: 'PENDING' },
      data: { status: 'SUCCEEDED', ...providerRefundId },
    });
    if (updated.count === 0) {
      log.warn('refund left PENDING while the provider call ran; outcome not recorded');
      return;
    }
    const paymentRefunded = await markPaymentRefundedIfComplete(ctx.tx, payment, event.orderId);
    log.info({ provider: payment.provider, paymentRefunded }, 'refund succeeded');
  });
}

/**
 * Payment → REFUNDED only when nothing of it is left: every sub-order of the order is REFUNDED
 * (admin refund) or CANCELLED (late-payment refund), and Σ SUCCEEDED refunds of this payment ≥
 * its amount. Otherwise it stays CONFIRMED (the admin refund endpoint requires a CONFIRMED one).
 */
async function markPaymentRefundedIfComplete(
  tx: Tx,
  payment: { id: string; amount: bigint },
  orderId: string,
): Promise<boolean> {
  const open = await tx.subOrder.count({
    where: { orderId, status: { notIn: ['REFUNDED', 'CANCELLED'] } },
  });
  if (open > 0) return false;
  const refunded = await tx.refund.aggregate({
    where: { paymentId: payment.id, status: 'SUCCEEDED' },
    _sum: { amount: true },
  });
  if ((refunded._sum.amount ?? 0n) < payment.amount) return false;
  const { count } = await tx.payment.updateMany({
    where: { id: payment.id, status: 'CONFIRMED' },
    data: { status: 'REFUNDED' },
  });
  return count === 1;
}
