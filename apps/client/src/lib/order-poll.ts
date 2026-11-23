import type { Order } from '@repo/core';
import { isPaymentSettled } from './order-status';
import { poll } from './poll';

export const ORDER_POLL_INTERVAL_MS = 2000;
export const ORDER_POLL_TIMEOUT_MS = 60_000;

export type OrderWaitResult =
  | { kind: 'settled'; order: Order }
  /** Still AWAITING_PAYMENT after the timeout (the IPN may be late): offer "check again". */
  | { kind: 'pending'; order: Order | null }
  | { kind: 'aborted' };

/**
 * After the VNPay return the browser can arrive before the IPN: poll the order until it is PAID
 * (or cancelled) — the return route itself never changes state (server/CLAUDE.md "Payments").
 */
export async function waitForOrderPayment(options: {
  fetchOrder: () => Promise<Order>;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<OrderWaitResult> {
  const result = await poll({
    attempt: options.fetchOrder,
    isDone: (order) => isPaymentSettled(order.status),
    intervalMs: options.intervalMs ?? ORDER_POLL_INTERVAL_MS,
    timeoutMs: options.timeoutMs ?? ORDER_POLL_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (result.kind === 'done') return { kind: 'settled', order: result.value };
  if (result.kind === 'timeout') return { kind: 'pending', order: result.last };
  return { kind: 'aborted' };
}
