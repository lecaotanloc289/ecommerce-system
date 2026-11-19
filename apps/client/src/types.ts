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

/** Sub-category ids; display names live in the i18n catalogue (`subcategories.*`). */
export type SubcategoryId =
  | 'headphones'
  | 'earbuds'
  | 'speakers'
  | 'mirrorless'
  | 'dslr'
  | 'lenses'
  | 'laptops'
  | 'tablets'
  | 'desktops'
  | 'smartwatches'
  | 'fitnessTrackers'
  | 'mice'
  | 'drawingTablets'
  | 'chargers'
  | 'tops'
  | 'outerwear'
  | 'shoes';

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  productCount: number;
  image?: string;
  subcategories: SubcategoryId[];
}

export interface Review {
  id: string;
  author: string;
  avatar?: string;
  rating: number; // 0..5
  date: string; // ISO
  title: string;
  body: string;
  helpfulCount: number;
  notHelpfulCount: number;
}

export interface ProductVariant {
  id: string;
  label: string; // e.g. "Black / 256GB"
  price: Money;
  stock: number;
}

/** Color ids; display names live in the i18n catalogue (`colors.*`). */
export type ColorName = 'black' | 'gray' | 'silver' | 'red' | 'indigo' | 'orange' | 'yellow';

export interface ProductColor {
  name: ColorName;
  hex: string;
}

export interface ProductSpec {
  label: string;
  value: string;
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
  colors?: ProductColor[];
  variants?: ProductVariant[];
  badge?: 'sale' | 'new' | 'bestseller';
  /** Vendor-supplied copy / attributes — optional; their sections hide when absent. */
  description?: string;
  specs?: ProductSpec[];
  boxItems?: string[];
}

/** Persisted guest-cart line (storefront CLAUDE.md §6): ids + qty only. */
export interface GuestCartLine {
  productId: string;
  variantId?: string | undefined;
  qty: number;
}

/** Cart line resolved against the catalogue for display and totals. */
export interface CartLine {
  key: string;
  product: Product;
  variantId?: string | undefined;
  variantLabel?: string | undefined;
  /** Unit price snapshot: the variant price when a variant is chosen, else the product price. */
  unitPrice: Money;
  qty: number;
  /** Max purchasable qty (variant stock when known). */
  maxQty: number;
}

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
  at: string; // ISO
  done: boolean;
}
