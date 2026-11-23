import type { ShippingMethod, TrackingStep, Voucher } from '../types';
import { CartItemSnapshotSchema, maxQtyFor, type CartLineView } from '../lib/cart';

/**
 * Checkout / order-tracking mocks — the last mock data in the storefront. Shipping methods,
 * vouchers and the placed order are replaced by the cart / checkout / orders API in T5.1.
 * The catalog and the guest cart already read the API.
 */

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

/** Line snapshot of the mock placed order (ids are well-formed ULIDs, not real rows). */
function orderLine(
  n: number,
  name: string,
  slug: string,
  amount: number,
  quantity: number,
): CartLineView {
  const id = (prefix: string) => `01JD${prefix}${String(n).padStart(20, '0')}`;
  const snapshot = CartItemSnapshotSchema.parse({
    variantId: id('VV'),
    productId: id('PP'),
    vendorId: id('SS'),
    productName: name,
    productSlug: slug,
    attributes: {},
    imageUrl: null,
    unitPrice: { amount, currency: 'VND' },
    stockAvailable: 99,
    vendorName: 'Elma',
    vendorSlug: 'elma',
  });
  return { ...snapshot, quantity, maxQty: maxQtyFor(snapshot.stockAvailable) };
}

/** A previously placed order, shown on the tracking page. */
export const placedOrder: {
  number: string;
  trackingNumber: string;
  lines: CartLineView[];
  shippingMethodId: string;
  voucherCode: string;
} = {
  number: 'ELM-2026-08431',
  trackingNumber: 'FDX-991-2261-VN',
  lines: [
    orderLine(1, 'Basic Tee', 'basic-tee', 199_000, 2),
    orderLine(2, 'White Ceramic Mug', 'white-ceramic-mug', 89_000, 1),
  ],
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
