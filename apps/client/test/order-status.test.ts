import { describe, expect, it } from 'vitest';
import {
  canCancelOrder,
  canConfirmReceived,
  canPayOrder,
  isPaymentSettled,
  paymentOutcome,
  subOrderTimeline,
} from '../src/lib/order-status';

const times = {
  shippedAt: null,
  deliveredAt: null,
  completedAt: null,
  cancelledAt: null,
};

const states = (status: Parameters<typeof subOrderTimeline>[0]['status'], over = {}) =>
  subOrderTimeline({ status, ...times, ...over }).steps.map((s) => s.state);

describe('subOrderTimeline', () => {
  it('marks steps before the current one done, the current one active, the rest upcoming', () => {
    expect(states('PAID')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('PROCESSING')).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('SHIPPED')).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
    expect(states('DELIVERED')).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
  });

  it('a completed sub-order has every step done', () => {
    expect(states('COMPLETED')).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('carries the API timestamps on their steps', () => {
    const { steps } = subOrderTimeline({
      status: 'DELIVERED',
      ...times,
      shippedAt: '2026-11-20T08:00:00.000Z',
      deliveredAt: '2026-11-22T08:00:00.000Z',
    });
    expect(steps.map((s) => s.at)).toEqual([
      null,
      null,
      '2026-11-20T08:00:00.000Z',
      '2026-11-22T08:00:00.000Z',
      null,
    ]);
  });

  it('has no active step for awaiting-payment, cancelled and refunded sub-orders', () => {
    for (const status of ['AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as const) {
      const timeline = subOrderTimeline({ status, ...times });
      expect(timeline.terminal).toBe(status);
      expect(timeline.steps.every((s) => s.state === 'upcoming')).toBe(true);
    }
    expect(
      subOrderTimeline({ status: 'CANCELLED', ...times, cancelledAt: '2026-11-21T00:00:00.000Z' })
        .terminalAt,
    ).toBe('2026-11-21T00:00:00.000Z');
  });
});

describe('payment outcome + actions', () => {
  it('maps order statuses for the success page', () => {
    expect(paymentOutcome('AWAITING_PAYMENT')).toBe('pending');
    expect(paymentOutcome('PAID')).toBe('paid');
    expect(paymentOutcome('COMPLETED')).toBe('paid');
    expect(paymentOutcome('CANCELLED')).toBe('cancelled');
    expect(isPaymentSettled('AWAITING_PAYMENT')).toBe(false);
    expect(isPaymentSettled('PAID')).toBe(true);
    expect(isPaymentSettled('CANCELLED')).toBe(true);
  });

  const sub = (status: 'AWAITING_PAYMENT' | 'PAID' | 'SHIPPED') => ({ status });
  it('cancel / pay only while every sub-order awaits payment', () => {
    const awaiting = { status: 'AWAITING_PAYMENT' as const, subOrders: [sub('AWAITING_PAYMENT')] };
    const paid = { status: 'PAID' as const, subOrders: [sub('PAID')] };
    expect(canCancelOrder(awaiting)).toBe(true);
    expect(canPayOrder(awaiting)).toBe(true);
    expect(canCancelOrder(paid)).toBe(false);
    expect(canPayOrder({ status: 'AWAITING_PAYMENT', subOrders: [] })).toBe(false);
  });

  it('confirm received for shipped / delivered sub-orders only', () => {
    expect(canConfirmReceived({ status: 'SHIPPED' })).toBe(true);
    expect(canConfirmReceived({ status: 'DELIVERED' })).toBe(true);
    expect(canConfirmReceived({ status: 'PROCESSING' })).toBe(false);
    expect(canConfirmReceived({ status: 'COMPLETED' })).toBe(false);
  });
});
