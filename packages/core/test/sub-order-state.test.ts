import { describe, expect, it } from 'vitest';
import { type SubOrderStatus, SubOrderStatusSchema } from '../src/enums';
import { DomainError } from '../src/errors';
import {
  SUB_ORDER_ACTORS,
  type SubOrderActor,
  assertTransition,
  canTransition,
  transitionSources,
} from '../src/orders';
import { VendorSubOrderQuerySchema, VendorSubOrderStatusSchema } from '../src/schemas/order';
import {
  OUTBOX_EVENT_SCHEMAS,
  SubOrderCompletedEventSchema,
  SubOrderDeliveredEventSchema,
  SubOrderShippedEventSchema,
} from '../src/schemas/outbox';
import { LedgerEntryPageSchema, VendorWalletSchema } from '../src/schemas/wallet';
import { ulid } from './fixtures';

/** The full allowed set (D11): `from>to:actor`. Everything not listed must be rejected. */
const ALLOWED = new Set([
  'AWAITING_PAYMENT>PAID:SYSTEM',
  'AWAITING_PAYMENT>CANCELLED:CUSTOMER',
  'AWAITING_PAYMENT>CANCELLED:SYSTEM',
  'PAID>PROCESSING:VENDOR',
  'PAID>REFUNDED:PLATFORM',
  'PROCESSING>SHIPPED:VENDOR',
  'PROCESSING>REFUNDED:PLATFORM',
  'SHIPPED>DELIVERED:VENDOR',
  'SHIPPED>COMPLETED:CUSTOMER',
  'SHIPPED>REFUNDED:PLATFORM',
  'DELIVERED>COMPLETED:CUSTOMER',
  'DELIVERED>COMPLETED:SYSTEM',
  'DELIVERED>REFUNDED:PLATFORM',
]);

const statuses = SubOrderStatusSchema.options;
const matrix: [SubOrderStatus, SubOrderStatus, SubOrderActor][] = statuses.flatMap((from) =>
  statuses.flatMap((to) =>
    SUB_ORDER_ACTORS.map((actor): [SubOrderStatus, SubOrderStatus, SubOrderActor] => [
      from,
      to,
      actor,
    ]),
  ),
);

describe('sub-order state machine (D11)', () => {
  it.each(matrix)('%s → %s by %s', (from, to, actor) => {
    const expected = ALLOWED.has(`${from}>${to}:${actor}`);
    expect(canTransition(from, to, actor)).toBe(expected);
    if (expected) {
      expect(() => assertTransition(from, to, actor)).not.toThrow();
    } else {
      expect(() => assertTransition(from, to, actor)).toThrow(DomainError);
    }
  });

  it('terminal statuses have no way out', () => {
    for (const from of ['COMPLETED', 'REFUNDED', 'CANCELLED'] as const) {
      for (const to of statuses) {
        for (const actor of SUB_ORDER_ACTORS) expect(canTransition(from, to, actor)).toBe(false);
      }
    }
  });

  it('assertTransition throws order.error.invalid-status-transition with from/to', () => {
    try {
      assertTransition('PAID', 'SHIPPED', 'VENDOR');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('order.error.invalid-status-transition');
      expect((error as DomainError).params).toEqual({ from: 'PAID', to: 'SHIPPED' });
    }
  });

  it('transitionSources lists the from-statuses of an edge', () => {
    expect(transitionSources('COMPLETED', 'CUSTOMER')).toEqual(['SHIPPED', 'DELIVERED']);
    expect(transitionSources('COMPLETED', 'SYSTEM')).toEqual(['DELIVERED']);
    expect(transitionSources('PROCESSING', 'VENDOR')).toEqual(['PAID']);
    expect(transitionSources('REFUNDED', 'PLATFORM')).toEqual([
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);
    expect(transitionSources('REFUNDED', 'VENDOR')).toEqual([]);
  });
});

describe('fulfilment schemas', () => {
  it('vendor status filter hides unpaid statuses', () => {
    expect(VendorSubOrderStatusSchema.options).toEqual([
      'PAID',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'REFUNDED',
    ]);
    expect(VendorSubOrderQuerySchema.safeParse({ status: 'SHIPPED' }).success).toBe(true);
    expect(VendorSubOrderQuerySchema.safeParse({ status: 'AWAITING_PAYMENT' }).success).toBe(false);
    expect(VendorSubOrderQuerySchema.parse({}).limit).toBe(20);
  });

  it('sub-order outbox payloads carry ids only', () => {
    const base = { orderId: ulid(1), subOrderId: ulid(2) };
    expect(SubOrderShippedEventSchema.safeParse({ ...base, customerId: ulid(3) }).success).toBe(
      true,
    );
    expect(SubOrderDeliveredEventSchema.safeParse({ ...base, customerId: ulid(3) }).success).toBe(
      true,
    );
    expect(SubOrderCompletedEventSchema.safeParse({ ...base, vendorId: ulid(4) }).success).toBe(
      true,
    );
    expect(SubOrderShippedEventSchema.safeParse(base).success).toBe(false);
    expect(SubOrderCompletedEventSchema.safeParse({ ...base, customerId: ulid(3) }).success).toBe(
      false,
    );
    expect(OUTBOX_EVENT_SCHEMAS['sub-order.shipped']).toBe(SubOrderShippedEventSchema);
    expect(OUTBOX_EVENT_SCHEMAS['sub-order.delivered']).toBe(SubOrderDeliveredEventSchema);
    expect(OUTBOX_EVENT_SCHEMAS['sub-order.completed']).toBe(SubOrderCompletedEventSchema);
  });

  it('vendor wallet: non-negative balance and pending per currency', () => {
    const wallet = {
      id: ulid(1),
      vendorId: ulid(2),
      balance: { amount: 0, currency: 'VND' },
      pending: [
        { amount: 120_000, currency: 'VND' },
        { amount: 500, currency: 'USD' },
      ],
    };
    expect(VendorWalletSchema.safeParse(wallet).success).toBe(true);
    expect(VendorWalletSchema.safeParse({ ...wallet, pending: [] }).success).toBe(true);
    expect(
      VendorWalletSchema.safeParse({ ...wallet, pending: [{ amount: -1, currency: 'VND' }] })
        .success,
    ).toBe(false);
    expect(LedgerEntryPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });
});
