'use client';

import * as React from 'react';
import { useRouter } from '@/i18n/navigation';
import type { PaymentProvider } from '@repo/core';
import { fetchPaymentSession, retryPayment } from '../../lib/api/commerce';
import {
  isSessionUsable,
  waitForPaymentSession,
  type PaymentSessionOutcome,
} from '../../lib/payment-session';
import { newIdempotencyKey as newUlid } from '../../lib/idempotency';

export type PaymentFlowState =
  | { phase: 'idle' }
  /** Waiting for the worker to create the provider session (202 → 200). */
  | { phase: 'polling' }
  | { phase: 'redirecting' }
  /** 30 s without a session: offer a retry. */
  | { phase: 'timeout' }
  /** The attempt failed (or a request threw `error`). */
  | { phase: 'failed'; error?: unknown };

/**
 * Drives the "pay for this order" hand-off: poll `GET /v1/orders/:id/payment` (1 s, ≤ 30 s) and
 * send the browser to the provider's `redirectUrl`.
 * - `follow(orderId)` — the attempt already exists (right after checkout);
 * - `pay(orderId, provider?)` — pay an existing order again: reuse a still-valid session unless
 *   the customer switches provider, else start a new attempt (`POST /v1/orders/:id/payments`).
 */
export function usePaymentFlow() {
  const router = useRouter();
  const [state, setState] = React.useState<PaymentFlowState>({ phase: 'idle' });
  const abortRef = React.useRef<AbortController | null>(null);
  const retryKeyRef = React.useRef<{ id: string; key: string } | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const follow = React.useCallback(
    async (orderId: string): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: 'polling' });
      let outcome: PaymentSessionOutcome;
      try {
        outcome = await waitForPaymentSession({
          fetchSession: () => fetchPaymentSession(orderId),
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) setState({ phase: 'failed', error });
        return;
      }
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'redirect') {
        setState({ phase: 'redirecting' });
        window.location.assign(outcome.url);
      } else if (outcome.kind === 'paid') {
        router.push(`/order/success?${new URLSearchParams({ orderId }).toString()}`);
      } else if (outcome.kind === 'timeout') {
        setState({ phase: 'timeout' });
      } else {
        setState({ phase: 'failed' });
      }
    },
    [router],
  );

  const pay = React.useCallback(
    async (orderId: string, provider?: PaymentProvider): Promise<void> => {
      setState({ phase: 'polling' });
      try {
        if (!provider) {
          const { session } = await fetchPaymentSession(orderId);
          if (isSessionUsable(session, Date.now()) && session.redirectUrl) {
            setState({ phase: 'redirecting' });
            window.location.assign(session.redirectUrl);
            return;
          }
        }
        // One key per (order, provider) until the call succeeds: a retry after a network error
        // replays instead of creating a second attempt.
        const id = `${orderId}:${provider ?? ''}`;
        if (retryKeyRef.current?.id !== id) retryKeyRef.current = { id, key: newUlid() };
        await retryPayment(orderId, provider, retryKeyRef.current.key);
        retryKeyRef.current = null;
      } catch (error) {
        setState({ phase: 'failed', error });
        return;
      }
      await follow(orderId);
    },
    [follow],
  );

  const reset = React.useCallback(() => setState({ phase: 'idle' }), []);

  return { state, follow, pay, reset };
}
