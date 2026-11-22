import { describe, expect, it } from 'vitest';
import type { OrderStatus, SubOrderStatus } from '../src/enums';
import { DomainError } from '../src/errors';
import { deriveOrderStatus, providerSupportsCurrency } from '../src/orders';
import { PaymentRetrySchema } from '../src/schemas/order';
import {
  OrderCancelledEventSchema,
  OrderCreatedEventSchema,
  OrderPaidEventSchema,
  OUTBOX_EVENT_SCHEMAS,
  PaymentRequestedEventSchema,
  PayoutReleasedEventSchema,
  SubOrderShippedEventSchema,
} from '../src/schemas/outbox';

describe('deriveOrderStatus (D11)', () => {
  const cases: [SubOrderStatus[], OrderStatus][] = [
    [['CANCELLED'], 'CANCELLED'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
    [['AWAITING_PAYMENT'], 'AWAITING_PAYMENT'],
    [['AWAITING_PAYMENT', 'AWAITING_PAYMENT'], 'AWAITING_PAYMENT'],
    [['REFUNDED'], 'REFUNDED'],
    [['REFUNDED', 'REFUNDED'], 'REFUNDED'],
    [['REFUNDED', 'PAID'], 'PARTIALLY_REFUNDED'],
    [['REFUNDED', 'COMPLETED'], 'PARTIALLY_REFUNDED'],
    [['REFUNDED', 'CANCELLED'], 'PARTIALLY_REFUNDED'],
    [['COMPLETED'], 'COMPLETED'],
    [['COMPLETED', 'COMPLETED'], 'COMPLETED'],
    [['COMPLETED', 'CANCELLED'], 'COMPLETED'],
    [['PAID'], 'PAID'],
    [['PAID', 'PROCESSING'], 'PAID'],
    [['SHIPPED', 'DELIVERED'], 'PAID'],
    [['COMPLETED', 'DELIVERED'], 'PAID'],
    [['PAID', 'CANCELLED'], 'PAID'],
  ];

  it.each(cases)('%j → %s', (subs, expected) => {
    expect(deriveOrderStatus(subs)).toBe(expected);
  });

  it('rejects an order without sub-orders', () => {
    expect(() => deriveOrderStatus([])).toThrow(DomainError);
  });
});

describe('providerSupportsCurrency', () => {
  it('VNPay charges VND only; Stripe charges VND and USD', () => {
    expect(providerSupportsCurrency('VNPAY', 'VND')).toBe(true);
    expect(providerSupportsCurrency('VNPAY', 'USD')).toBe(false);
    expect(providerSupportsCurrency('STRIPE', 'VND')).toBe(true);
    expect(providerSupportsCurrency('STRIPE', 'USD')).toBe(true);
  });
});

describe('outbox payload schemas', () => {
  const orderId = '01JABCDEFGHJKMNPQRSTVWXYZ0';
  const userId = '01JABCDEFGHJKMNPQRSTVWXYZ1';

  it('parse valid payloads', () => {
    expect(OrderCreatedEventSchema.parse({ orderId, customerId: userId })).toBeTruthy();
    expect(
      PaymentRequestedEventSchema.parse({
        orderId,
        paymentId: userId,
        provider: 'VNPAY',
        attemptNo: 1,
      }),
    ).toBeTruthy();
    expect(
      OrderCancelledEventSchema.parse({ orderId, customerId: userId, reason: 'PAYMENT_EXPIRED' }),
    ).toBeTruthy();
  });

  it('reject malformed payloads', () => {
    expect(OrderCreatedEventSchema.safeParse({ orderId: 'x', customerId: userId }).success).toBe(
      false,
    );
    expect(
      PaymentRequestedEventSchema.safeParse({ orderId, paymentId: userId, provider: 'VNPAY' })
        .success,
    ).toBe(false);
    expect(
      OrderCancelledEventSchema.safeParse({ orderId, customerId: userId, reason: 'BORED' }).success,
    ).toBe(false);
  });

  it('cover the notification events (ids only)', () => {
    expect(OrderPaidEventSchema.parse({ orderId, customerId: userId })).toBeTruthy();
    expect(
      SubOrderShippedEventSchema.parse({ orderId, subOrderId: orderId, customerId: userId }),
    ).toBeTruthy();
    expect(
      PayoutReleasedEventSchema.parse({ subOrderId: orderId, vendorId: userId }),
    ).toBeTruthy();
    expect(SubOrderShippedEventSchema.safeParse({ orderId, customerId: userId }).success).toBe(
      false,
    );
    expect(PayoutReleasedEventSchema.safeParse({ subOrderId: 'x', vendorId: userId }).success).toBe(false);
  });

  it('maps every event type to its schema', () => {
    expect(Object.keys(OUTBOX_EVENT_SCHEMAS).sort()).toEqual([
      'order.cancelled',
      'order.created',
      'order.paid',
      'payment.requested',
      'payout.released',
      'refund.requested',
      'sub-order.completed',
      'sub-order.delivered',
      'sub-order.shipped',
      'vendor.application.approved',
      'vendor.application.rejected',
      'vendor.invitation.created',
    ]);
  });
});

describe('PaymentRetrySchema', () => {
  it('accepts an empty body or a known provider', () => {
    expect(PaymentRetrySchema.parse({})).toEqual({});
    expect(PaymentRetrySchema.parse({ provider: 'STRIPE' })).toEqual({ provider: 'STRIPE' });
  });

  it('rejects an unknown provider', () => {
    expect(PaymentRetrySchema.safeParse({ provider: 'PAYPAL' }).success).toBe(false);
  });
});
