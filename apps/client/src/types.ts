import type { Money, PaymentProvider, SubOrderStatus } from '@repo/core';

/**
 * Storefront-only types. Catalog and cart shapes come from `@repo/core` (Golden Rule #1) —
 * `ProductSummary`, `ProductDetail`, `CategoryNode`, `Review`, … — and the guest cart view
 * types live in `src/lib/cart.ts`. What is left here are interim checkout/tracking shapes
 * backed by `src/mocks/cart.ts` until T5.1 wires checkout to the API.
 * Money is integer minor units + ISO currency (Golden Rule #2): VND = đồng, USD = cent.
 */
export type { Currency, Money } from '@repo/core';

export type ShippingCarrier = 'fedex' | 'dhl' | 'jne' | 'pos';

export interface ShippingMethod {
  id: string;
  carrier: ShippingCarrier;
  name: string;
  eta: { minDays: number; maxDays: number };
  fee: Money;
}

/** Mock voucher (subset of the `Coupon` model, storefront CLAUDE.md §9). FIXED only for now. */
export interface Voucher {
  code: string;
  type: 'FIXED';
  amount: Money;
  minSubtotal: Money;
}

/** Payment picker options: core providers (lowercased) plus the UI-only `wallet` option. */
export type PaymentProviderId = Lowercase<PaymentProvider> | 'wallet';

/** Tracking timeline statuses — the forward path of core's SubOrderStatus (no refund/cancel). */
export type OrderStatus = Extract<
  SubOrderStatus,
  'AWAITING_PAYMENT' | 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'COMPLETED'
>;

export interface TrackingStep {
  status: OrderStatus;
  at: string; // ISO
  done: boolean;
}
