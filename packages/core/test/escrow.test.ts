import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors';
import { of } from '../src/money';
import {
  computeEscrowInPostings,
  computeRefundPostings,
  subOrderNet,
  subOrderPaid,
} from '../src/orders';
import { computePayoutPostings } from '../src/pricing';
import {
  OrderPaidEventSchema,
  OUTBOX_EVENT_SCHEMAS,
  RefundRequestedEventSchema,
} from '../src/schemas/outbox';

const vnd = (amount: number) => of(amount, 'VND');

describe('subOrderPaid (D7)', () => {
  it('= subtotal + shipping − vendorDiscount − platformDiscount', () => {
    expect(
      subOrderPaid({
        subtotal: vnd(200_000),
        shipping: vnd(30_000),
        vendorDiscount: vnd(10_000),
        platformDiscount: vnd(19_000),
      }),
    ).toEqual(vnd(201_000));
  });

  it('can be zero (free order)', () => {
    expect(
      subOrderPaid({
        subtotal: vnd(50_000),
        shipping: vnd(0),
        vendorDiscount: vnd(50_000),
        platformDiscount: vnd(0),
      }),
    ).toEqual(vnd(0));
  });

  it('rejects a negative result and mixed currencies', () => {
    expect(() =>
      subOrderPaid({
        subtotal: vnd(10),
        shipping: vnd(0),
        vendorDiscount: vnd(20),
        platformDiscount: vnd(0),
      }),
    ).toThrow(DomainError);
    expect(() =>
      subOrderPaid({
        subtotal: of(10, 'USD'),
        shipping: vnd(0),
        vendorDiscount: vnd(0),
        platformDiscount: vnd(0),
      }),
    ).toThrow(DomainError);
  });
});

describe('subOrderNet (D7)', () => {
  const charges = {
    subtotal: vnd(200_000),
    shipping: vnd(30_000),
    vendorDiscount: vnd(10_000),
    platformDiscount: vnd(19_000),
    commission: vnd(22_000),
  };

  it('= subtotal + shipping − vendorDiscount − commission (platform discount ignored)', () => {
    expect(subOrderNet(charges)).toEqual(vnd(198_000));
  });

  it('feeds zero-sum payout postings together with subOrderPaid', () => {
    const postings = computePayoutPostings({
      paid: subOrderPaid(charges),
      net: subOrderNet(charges),
      commission: charges.commission,
      platformDiscount: charges.platformDiscount,
    });
    expect(postings).toEqual([
      { account: 'PLATFORM_ESCROW', amount: vnd(-201_000) },
      { account: 'VENDOR_WALLET', amount: vnd(198_000) },
      { account: 'PLATFORM_REVENUE', amount: vnd(3_000) },
    ]);
  });

  it('rejects a negative net and mixed currencies', () => {
    expect(() => subOrderNet({ ...charges, commission: vnd(300_000) })).toThrow(DomainError);
    expect(() => subOrderNet({ ...charges, commission: of(1, 'USD') })).toThrow(DomainError);
  });
});

describe('escrow postings', () => {
  it('escrow IN: CUSTOMER −paid, PLATFORM_ESCROW +paid (zero-sum)', () => {
    const postings = computeEscrowInPostings(vnd(230_000));
    expect(postings).toEqual([
      { account: 'CUSTOMER', amount: vnd(-230_000) },
      { account: 'PLATFORM_ESCROW', amount: vnd(230_000) },
    ]);
    expect(postings[0].amount.amount + postings[1].amount.amount).toBe(0);
  });

  it('refund: PLATFORM_ESCROW −paid, CUSTOMER +paid', () => {
    expect(computeRefundPostings(of(1_999, 'USD'))).toEqual([
      { account: 'PLATFORM_ESCROW', amount: of(-1_999, 'USD') },
      { account: 'CUSTOMER', amount: of(1_999, 'USD') },
    ]);
  });

  it('rejects a negative amount', () => {
    expect(() => computeEscrowInPostings(vnd(-1))).toThrow(DomainError);
  });
});

describe('order.paid / refund.requested payloads', () => {
  const id = (n: number) => `01JABCDEFGHJKMNPQRSTVWXYZ${n}`;

  it('parse valid payloads and are registered', () => {
    expect(OrderPaidEventSchema.parse({ orderId: id(0), customerId: id(1) })).toBeTruthy();
    expect(
      RefundRequestedEventSchema.parse({ refundId: id(2), orderId: id(0), subOrderId: id(3) }),
    ).toBeTruthy();
    expect(OUTBOX_EVENT_SCHEMAS['order.paid']).toBe(OrderPaidEventSchema);
    expect(OUTBOX_EVENT_SCHEMAS['refund.requested']).toBe(RefundRequestedEventSchema);
  });

  it('reject malformed payloads', () => {
    expect(OrderPaidEventSchema.safeParse({ orderId: id(0) }).success).toBe(false);
    expect(RefundRequestedEventSchema.safeParse({ refundId: id(2), orderId: id(0) }).success).toBe(
      false,
    );
  });
});
