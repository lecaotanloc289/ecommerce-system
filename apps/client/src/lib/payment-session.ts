import type { PaymentSession } from '@repo/core';
import { poll } from './poll';

/**
 * `GET /v1/orders/:id/payment` (server/CLAUDE.md "Orders"): **202** while the latest attempt is
 * PENDING and the worker has not produced `redirectUrl` yet, **200** once it is set or the
 * attempt is no longer PENDING. Same body either way.
 */
export interface PaymentSessionReply {
  httpStatus: number;
  session: PaymentSession;
}

export type PaymentSessionOutcome =
  | { kind: 'redirect'; url: string }
  /** Confirmed without sending the customer anywhere (e.g. a zero-amount order). */
  | { kind: 'paid' }
  /** The attempt failed or was refunded: offer a retry. */
  | { kind: 'failed' }
  | { kind: 'timeout' }
  | { kind: 'aborted' };

export const PAYMENT_POLL_INTERVAL_MS = 1000;
export const PAYMENT_POLL_TIMEOUT_MS = 30_000;

/** The reply is final: stop polling. */
export function isSessionSettled(reply: PaymentSessionReply): boolean {
  if (reply.httpStatus === 202) return false;
  return !(reply.session.status === 'PENDING' && reply.session.redirectUrl === null);
}

/** What a settled reply means for the customer. */
export function outcomeOf(session: PaymentSession): PaymentSessionOutcome {
  if (session.status === 'CONFIRMED') return { kind: 'paid' };
  if (session.status === 'FAILED' || session.status === 'REFUNDED') return { kind: 'failed' };
  return session.redirectUrl ? { kind: 'redirect', url: session.redirectUrl } : { kind: 'failed' };
}

/** A PENDING session whose provider page can still be opened (not expired). */
export function isSessionUsable(session: PaymentSession, nowMs: number): boolean {
  if (session.status !== 'PENDING' || session.redirectUrl === null) return false;
  return session.expiresAt === null || Date.parse(session.expiresAt) > nowMs;
}

export interface WaitForSessionOptions {
  fetchSession: () => Promise<PaymentSessionReply>;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Poll the payment session (1 s, up to 30 s by default) until it is settled. */
export async function waitForPaymentSession(
  options: WaitForSessionOptions,
): Promise<PaymentSessionOutcome> {
  const result = await poll({
    attempt: options.fetchSession,
    isDone: isSessionSettled,
    intervalMs: options.intervalMs ?? PAYMENT_POLL_INTERVAL_MS,
    timeoutMs: options.timeoutMs ?? PAYMENT_POLL_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (result.kind === 'done') return outcomeOf(result.value.session);
  return { kind: result.kind };
}
