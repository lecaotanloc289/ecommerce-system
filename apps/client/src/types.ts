/**
 * Interim storefront types. Local until `@repo/core` Zod schemas land — at which
 * point these are replaced by `z.infer` exports (root CLAUDE.md Golden Rule #1).
 * Money is integer minor units + ISO currency (Golden Rule #2): VND = đồng, USD = cent.
 */

export type Locale = 'vi' | 'en';
export type Currency = 'VND' | 'USD';

export interface Money {
  amount: number; // integer, minor unit
  currency: Currency;
}

export interface Brand {
  id: string;
  name: string;
  logo: string; // emoji/text placeholder until real SVG assets
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  productCount: number;
  image?: string;
}

export interface Review {
  id: string;
  author: string;
  avatar?: string;
  rating: number; // 0..5
  date: string; // ISO
  title: string;
  body: string;
}

export interface ProductVariant {
  id: string;
  label: string; // e.g. "Black / 256GB"
  price: Money;
  stock: number;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  brand: string;
  vendorId: string;
  vendorName: string;
  image: string;
  gallery: string[];
  price: Money;
  compareAt?: Money; // strikethrough original
  rating: number;
  reviewCount: number;
  soldCount: number;
  inStock: boolean;
  categorySlug: string;
  colors?: string[];
  variants?: ProductVariant[];
  badge?: 'sale' | 'new' | 'bestseller';
}

export interface CartLine {
  product: Product;
  variantLabel?: string;
  qty: number;
}

export interface CartVendorGroup {
  vendorId: string;
  vendorName: string;
  lines: CartLine[];
}

export type ShippingCarrier = 'fedex' | 'dhl' | 'jne' | 'pos';

export interface ShippingMethod {
  id: string;
  carrier: ShippingCarrier;
  name: string;
  etaDays: string;
  fee: Money;
}

export type PaymentProviderId = 'vnpay' | 'stripe' | 'wallet';

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED';

export interface TrackingStep {
  status: OrderStatus;
  label: string;
  at: string; // ISO
  done: boolean;
}
