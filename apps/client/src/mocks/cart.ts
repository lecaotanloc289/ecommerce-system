import type { CartLine, GuestCartLine, ShippingMethod, TrackingStep, Voucher } from '../types';
import { cartLineKey, MAX_LINE_QTY } from '../lib/cart';
import { products } from './products';

/** Seed for a first-visit guest cart (multi-vendor, storefront CLAUDE.md §6). */
export const seedCartLines: GuestCartLine[] = [
  { productId: 'p3', qty: 1 },
  { productId: 'p4', qty: 2 },
  { productId: 'p7', qty: 1 },
];

/** True when the line's product (and variant, if any) exist in the mock catalogue. */
export function canResolveCartLine(line: GuestCartLine): boolean {
  const product = products.find((p) => p.id === line.productId);
  if (!product) return false;
  return line.variantId === undefined || !!product.variants?.some((v) => v.id === line.variantId);
}

/**
 * Resolve a persisted line against the mock catalogue. The unit price is the
 * variant price when a variant is chosen. Replaced by the server cart once
 * `@repo/sdk` exists. Throws on unknown ids — callers sanitize stored data first.
 */
export function resolveCartLine(line: GuestCartLine): CartLine {
  const product = products.find((p) => p.id === line.productId);
  if (!product) {
    throw new Error(`Cart line references unknown product id "${line.productId}"`);
  }
  const variant =
    line.variantId === undefined
      ? undefined
      : product.variants?.find((v) => v.id === line.variantId);
  if (line.variantId !== undefined && !variant) {
    throw new Error(
      `Cart line references unknown variant id "${line.variantId}" of product "${product.id}"`,
    );
  }
  return {
    key: cartLineKey(product.id, variant?.id),
    product,
    variantId: variant?.id,
    variantLabel: variant?.label,
    unitPrice: variant?.price ?? product.price,
    qty: line.qty,
    maxQty: variant ? Math.min(variant.stock, MAX_LINE_QTY) : MAX_LINE_QTY,
  };
}

export const shippingMethods: ShippingMethod[] = [
  {
    id: 's-fedex',
    carrier: 'fedex',
    name: 'FedEx Express',
    eta: { minDays: 1, maxDays: 2 },
    fee: { amount: 60_000, currency: 'VND' },
  },
  {
    id: 's-dhl',
    carrier: 'dhl',
    name: 'DHL Standard',
    eta: { minDays: 2, maxDays: 4 },
    fee: { amount: 40_000, currency: 'VND' },
  },
  {
    id: 's-jne',
    carrier: 'jne',
    name: 'JNE Regular',
    eta: { minDays: 3, maxDays: 5 },
    fee: { amount: 25_000, currency: 'VND' },
  },
  {
    id: 's-pos',
    carrier: 'pos',
    name: 'POS Economy',
    eta: { minDays: 5, maxDays: 7 },
    fee: { amount: 0, currency: 'VND' },
  },
];

export function findShippingMethod(id: string | null): ShippingMethod | undefined {
  return shippingMethods.find((m) => m.id === id);
}

/** Mock voucher table. Codes are matched case-insensitively. */
export const vouchers: Voucher[] = [
  {
    code: 'ELMA150K',
    type: 'FIXED',
    amount: { amount: 150_000, currency: 'VND' },
    minSubtotal: { amount: 1_000_000, currency: 'VND' },
  },
  {
    code: 'WELCOME50K',
    type: 'FIXED',
    amount: { amount: 50_000, currency: 'VND' },
    minSubtotal: { amount: 0, currency: 'VND' },
  },
];

export function findVoucher(code: string | null): Voucher | undefined {
  if (!code) return undefined;
  const normalized = code.trim().toUpperCase();
  return vouchers.find((v) => v.code === normalized);
}

/** A previously placed order, shown on the tracking page. */
export const placedOrder: {
  number: string;
  trackingNumber: string;
  lines: GuestCartLine[];
  shippingMethodId: string;
  voucherCode: string;
} = {
  number: 'ELM-2026-08431',
  trackingNumber: 'FDX-991-2261-VN',
  lines: seedCartLines,
  shippingMethodId: 's-fedex',
  voucherCode: 'ELMA150K',
};

export const trackingSteps: TrackingStep[] = [
  { status: 'PAID', at: '2026-06-05T09:12:00Z', done: true },
  { status: 'PROCESSING', at: '2026-06-05T16:40:00Z', done: true },
  { status: 'SHIPPED', at: '2026-06-06T08:05:00Z', done: true },
  { status: 'DELIVERED', at: '2026-06-08T07:30:00Z', done: false },
  { status: 'COMPLETED', at: '2026-06-08T15:00:00Z', done: false },
];
