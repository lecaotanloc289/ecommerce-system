import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors';
import * as M from '../src/money';
import { refundAmount, refundPostings } from '../src/pricing';
import { RefundListQuerySchema } from '../src/schemas/refund';
import { OUTBOX_EVENT_SCHEMAS, RefundRequestedEventSchema } from '../src/schemas/outbox';

const vnd = (n: number) => M.of(n, 'VND');
const ID = '01JD0000000000000000000000';

describe('refundAmount (D7 paid_i)', () => {
  it('is subtotal + shipping − vendorDiscount − platformDiscount', () => {
    expect(
      refundAmount({
        subtotal: vnd(200_000),
        shipping: vnd(30_000),
        vendorDiscount: vnd(10_000),
        platformDiscount: vnd(19_000),
      }),
    ).toEqual(vnd(201_000));
  });

  it('may be zero (free shipping + 100% coupons)', () => {
    expect(
      refundAmount({
        subtotal: vnd(100_000),
        shipping: vnd(0),
        vendorDiscount: vnd(40_000),
        platformDiscount: vnd(60_000),
      }),
    ).toEqual(vnd(0));
  });

  it('throws on a negative result and on mixed currencies', () => {
    expect(() =>
      refundAmount({
        subtotal: vnd(100),
        shipping: vnd(0),
        vendorDiscount: vnd(0),
        platformDiscount: vnd(101),
      }),
    ).toThrow(DomainError);
    expect(() =>
      refundAmount({
        subtotal: vnd(100),
        shipping: M.of(0, 'USD'),
        vendorDiscount: vnd(0),
        platformDiscount: vnd(0),
      }),
    ).toThrow(DomainError);
  });
});

describe('refundPostings (D12)', () => {
  it('moves paid from escrow to the customer and sums to zero', () => {
    const postings = refundPostings(M.of(1_234, 'USD'));
    expect(postings).toEqual([
      { account: 'PLATFORM_ESCROW', amount: M.of(-1_234, 'USD') },
      { account: 'CUSTOMER', amount: M.of(1_234, 'USD') },
    ]);
    expect(
      M.isZero(
        M.sum(
          postings.map((p) => p.amount),
          'USD',
        ),
      ),
    ).toBe(true);
  });

  it('allows zero, rejects negative', () => {
    expect(refundPostings(vnd(0)).every((p) => M.isZero(p.amount))).toBe(true);
    expect(() => refundPostings(vnd(-1))).toThrow(DomainError);
  });
});

describe('refund schemas', () => {
  it('RefundRequestedEvent: ids only, registered for the worker', () => {
    const payload = { refundId: ID, orderId: ID, subOrderId: ID };
    expect(RefundRequestedEventSchema.parse(payload)).toEqual(payload);
    expect(RefundRequestedEventSchema.safeParse({ refundId: ID, orderId: ID }).success).toBe(false);
    expect(OUTBOX_EVENT_SCHEMAS['refund.requested']).toBe(RefundRequestedEventSchema);
  });

  it('RefundListQuery: optional status, coerced limit', () => {
    expect(RefundListQuerySchema.parse({ status: 'PENDING', limit: '5' })).toEqual({
      status: 'PENDING',
      limit: 5,
    });
    expect(RefundListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });
});
