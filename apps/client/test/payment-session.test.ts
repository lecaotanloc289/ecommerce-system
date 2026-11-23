import { describe, expect, it } from 'vitest';
import { PaymentSessionSchema } from '@repo/core';
import {
  isSessionUsable,
  waitForPaymentSession,
  type PaymentSessionReply,
} from '../src/lib/payment-session';
import { waitForOrderPayment } from '../src/lib/order-poll';
import { poll } from '../src/lib/poll';
import { newUlid } from '../src/lib/ulid';
import { OrderSchema } from '@repo/core';

const reply = (httpStatus: number, body: Record<string, unknown>): PaymentSessionReply => ({
  httpStatus,
  session: PaymentSessionSchema.parse({ expiresAt: null, redirectUrl: null, ...body }),
});

/** Virtual clock: `sleep` advances time, so no real waiting. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

describe('waitForPaymentSession', () => {
  it('keeps polling on 202 and redirects once the session is 200 with a URL', async () => {
    const replies = [
      reply(202, { status: 'PENDING' }),
      reply(202, { status: 'PENDING' }),
      reply(200, { status: 'PENDING', redirectUrl: 'https://pay.example/session' }),
    ];
    let calls = 0;
    const outcome = await waitForPaymentSession({
      fetchSession: () => Promise.resolve(replies[calls++] ?? replies[2]!),
      ...clock(),
    });
    expect(calls).toBe(3);
    expect(outcome).toEqual({ kind: 'redirect', url: 'https://pay.example/session' });
  });

  it('times out after 30 s of 202 replies (1 s interval)', async () => {
    let calls = 0;
    const outcome = await waitForPaymentSession({
      fetchSession: () => {
        calls++;
        return Promise.resolve(reply(202, { status: 'PENDING' }));
      },
      ...clock(),
    });
    expect(outcome).toEqual({ kind: 'timeout' });
    expect(calls).toBeGreaterThanOrEqual(30);
    expect(calls).toBeLessThanOrEqual(31);
  });

  it('maps settled non-redirect sessions: confirmed → paid, failed → failed', async () => {
    const paid = await waitForPaymentSession({
      fetchSession: () => Promise.resolve(reply(200, { status: 'CONFIRMED' })),
      ...clock(),
    });
    const failed = await waitForPaymentSession({
      fetchSession: () => Promise.resolve(reply(200, { status: 'FAILED' })),
      ...clock(),
    });
    expect(paid).toEqual({ kind: 'paid' });
    expect(failed).toEqual({ kind: 'failed' });
  });

  it('stops when aborted and propagates request errors', async () => {
    const controller = new AbortController();
    const aborted = await waitForPaymentSession({
      fetchSession: () => {
        controller.abort();
        return Promise.resolve(reply(202, { status: 'PENDING' }));
      },
      signal: controller.signal,
      ...clock(),
    });
    expect(aborted).toEqual({ kind: 'aborted' });
    await expect(
      waitForPaymentSession({
        fetchSession: () => Promise.reject(new Error('boom')),
        ...clock(),
      }),
    ).rejects.toThrow('boom');
  });
});

describe('isSessionUsable', () => {
  const now = Date.parse('2026-11-23T10:00:00Z');
  it('accepts a pending session with a URL that has not expired', () => {
    const live = reply(200, {
      status: 'PENDING',
      redirectUrl: 'https://pay.example/s',
      expiresAt: '2026-11-23T10:15:00Z',
    }).session;
    const expired = reply(200, {
      status: 'PENDING',
      redirectUrl: 'https://pay.example/s',
      expiresAt: '2026-11-23T09:00:00Z',
    }).session;
    expect(isSessionUsable(live, now)).toBe(true);
    expect(isSessionUsable(expired, now)).toBe(false);
    expect(isSessionUsable(reply(200, { status: 'FAILED' }).session, now)).toBe(false);
  });
});

describe('poll / waitForOrderPayment / newUlid', () => {
  it('poll returns the last value on timeout', async () => {
    const result = await poll({
      attempt: () => Promise.resolve(1),
      isDone: () => false,
      intervalMs: 10,
      timeoutMs: 25,
      ...clock(),
    });
    expect(result).toEqual({ kind: 'timeout', last: 1 });
  });

  it('waits for the order to leave AWAITING_PAYMENT after the VNPay return', async () => {
    const base = {
      id: newUlid(),
      itemsTotal: { amount: 0, currency: 'VND' },
      shippingTotal: { amount: 0, currency: 'VND' },
      discountTotal: { amount: 0, currency: 'VND' },
      grandTotal: { amount: 0, currency: 'VND' },
      paymentDeadlineAt: null,
      subOrders: [],
      createdAt: '2026-11-23T10:00:00.000Z',
    };
    const statuses = ['AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'PAID'] as const;
    let calls = 0;
    const result = await waitForOrderPayment({
      fetchOrder: () =>
        Promise.resolve(OrderSchema.parse({ ...base, status: statuses[calls++] ?? 'PAID' })),
      ...clock(),
    });
    expect(calls).toBe(3);
    expect(result.kind === 'settled' && result.order.status).toBe('PAID');

    const stuck = await waitForOrderPayment({
      fetchOrder: () => Promise.resolve(OrderSchema.parse({ ...base, status: 'AWAITING_PAYMENT' })),
      ...clock(),
    });
    expect(stuck.kind).toBe('pending');
  });

  it('newUlid makes a valid ULID', () => {
    expect(newUlid()).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(newUlid()).not.toBe(newUlid());
  });
});
