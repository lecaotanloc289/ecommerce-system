import type { CartVendorGroup, ShippingMethod, TrackingStep } from '../types';
import { products } from './products';

const byId = (id: string) => products.find((p) => p.id === id)!;

/** Multi-vendor cart: lines grouped per vendor (storefront CLAUDE.md §6). */
export const cartGroups: CartVendorGroup[] = [
  {
    vendorId: 'v-apple',
    vendorName: 'Apple Store Official',
    lines: [
      { product: byId('p3'), variantLabel: 'Black', qty: 1 },
      { product: byId('p4'), qty: 2 },
    ],
  },
  {
    vendorId: 'v-fashion',
    vendorName: 'Urban Threads',
    lines: [{ product: byId('p7'), variantLabel: 'Yellow / M', qty: 1 }],
  },
];

export const shippingMethods: ShippingMethod[] = [
  {
    id: 's-fedex',
    carrier: 'fedex',
    name: 'FedEx Express',
    etaDays: '1–2 days',
    fee: { amount: 60_000, currency: 'VND' },
  },
  {
    id: 's-dhl',
    carrier: 'dhl',
    name: 'DHL Standard',
    etaDays: '2–4 days',
    fee: { amount: 40_000, currency: 'VND' },
  },
  {
    id: 's-jne',
    carrier: 'jne',
    name: 'JNE Regular',
    etaDays: '3–5 days',
    fee: { amount: 25_000, currency: 'VND' },
  },
  {
    id: 's-pos',
    carrier: 'pos',
    name: 'POS Economy',
    etaDays: '5–7 days',
    fee: { amount: 0, currency: 'VND' },
  },
];

export const trackingSteps: TrackingStep[] = [
  { status: 'PAID', label: 'Order confirmed', at: '2026-06-05T09:12:00Z', done: true },
  { status: 'PROCESSING', label: 'Packed by vendor', at: '2026-06-05T16:40:00Z', done: true },
  { status: 'SHIPPED', label: 'Handed to carrier', at: '2026-06-06T08:05:00Z', done: true },
  { status: 'DELIVERED', label: 'Out for delivery', at: '2026-06-08T07:30:00Z', done: false },
  { status: 'COMPLETED', label: 'Delivered', at: '2026-06-08T15:00:00Z', done: false },
];
