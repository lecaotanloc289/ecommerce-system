import {
  CartLineSchema,
  CartVendorGroupSchema,
  MAX_CART_LINE_QUANTITY,
  type CartLineInput,
  type ProductDetail,
  type ProductVariant,
} from '@repo/core';
import { compare, isNegative, multiply, subtract, sum, zero } from '@repo/core/money';
import type { Currency, Money, ShippingMethod, Voucher } from '../types';

/** Upper bound for a single line's quantity (core's payload bound; stock usually caps first). */
export const MAX_LINE_QTY = MAX_CART_LINE_QUANTITY;

/**
 * Display data the guest cart keeps per variant, captured from the catalog API when the item
 * is added and refreshed from `GET /v1/products/:slug` on the cart page. Same field names as the
 * server `CartLine` / `CartVendorGroup` (core), so T5.1's server cart renders through the same UI.
 * Prices are only shown — checkout re-reads every price server-side.
 */
export const CartItemSnapshotSchema = CartLineSchema.pick({
  variantId: true,
  productId: true,
  vendorId: true,
  productName: true,
  productSlug: true,
  attributes: true,
  imageUrl: true,
  unitPrice: true,
  stockAvailable: true,
}).extend({
  vendorName: CartVendorGroupSchema.shape.vendorName,
  vendorSlug: CartVendorGroupSchema.shape.vendorSlug,
});
export type CartItemSnapshot = ReturnType<typeof CartItemSnapshotSchema.parse>;

/** A guest cart line resolved for display: persisted `{ variantId, quantity }` + its snapshot. */
export interface CartLineView extends CartItemSnapshot {
  quantity: number;
  /** Max purchasable quantity (stock, capped at `MAX_LINE_QTY`). */
  maxQty: number;
}

/** Number of items in the cart — the sum of quantities, not the number of lines. */
export function cartItemCount(lines: readonly Pick<CartLineInput, 'quantity'>[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** unitPrice × quantity, integer minor units (core `multiply` rejects fractional qty / overflow). */
export function lineTotal(line: Pick<CartLineView, 'unitPrice' | 'quantity'>): Money {
  return multiply(line.unitPrice, line.quantity);
}

/** Max quantity a shopper may pick for a variant with `stockAvailable` units left. */
export function maxQtyFor(stockAvailable: number): number {
  return Math.max(0, Math.min(stockAvailable, MAX_LINE_QTY));
}

/** "M / black" from `{ size: 'M', color: 'black' }`; '' when there are no attributes. */
export function attributesLabel(attributes: ProductVariant['attributes']): string {
  return Object.values(attributes)
    .filter((v) => v.trim() !== '')
    .join(' / ');
}

/** Variant option label: its attribute values, or the SKU when it has none. */
export function variantLabel(variant: Pick<ProductVariant, 'attributes' | 'sku'>): string {
  return attributesLabel(variant.attributes) || variant.sku;
}

/** Variants a shopper can buy now (stock left). */
export function purchasableVariants(product: Pick<ProductDetail, 'variants'>): ProductVariant[] {
  return product.variants.filter((v) => v.stockAvailable > 0);
}

/** Variant preselected on the product page: the first one in stock, else the first one. */
export function defaultVariant(
  product: Pick<ProductDetail, 'variants'>,
): ProductVariant | undefined {
  return purchasableVariants(product)[0] ?? product.variants[0];
}

/** Snapshot of one variant of an API product, for the guest cart. */
export function toCartSnapshot(product: ProductDetail, variant: ProductVariant): CartItemSnapshot {
  return {
    variantId: variant.id,
    productId: product.id,
    vendorId: product.vendorId,
    productName: product.name,
    productSlug: product.slug,
    attributes: variant.attributes,
    imageUrl: product.primaryImageUrl,
    unitPrice: variant.price,
    stockAvailable: variant.stockAvailable,
    vendorName: product.vendor.displayName,
    vendorSlug: product.vendor.slug,
  };
}

/**
 * Whether `subtotal` reaches the voucher's minimum spend. A minimum in another currency never
 * matches (core `compare` refuses cross-currency comparisons). Shared by the totals and the
 * voucher form so "applied" and "discounted" can't disagree.
 */
export function meetsMinSpend(voucher: Voucher, subtotal: Money): boolean {
  return (
    voucher.minSubtotal.currency === subtotal.currency &&
    compare(subtotal, voucher.minSubtotal) >= 0
  );
}

/** FIXED voucher discount, capped at the subtotal; zero when inapplicable (currency or minimum spend). */
export function voucherDiscount(voucher: Voucher | undefined, subtotal: Money): Money {
  if (
    !voucher ||
    voucher.amount.currency !== subtotal.currency ||
    !meetsMinSpend(voucher, subtotal)
  ) {
    return zero(subtotal.currency);
  }
  return compare(voucher.amount, subtotal) <= 0 ? { ...voucher.amount } : { ...subtotal };
}

export interface OrderTotals {
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  discount: Money;
  total: Money;
}

/**
 * Single source of truth for cart/checkout totals. All math goes through @repo/core Money,
 * which throws if lines or shipping mix currencies.
 */
export function computeTotals(
  lines: readonly CartLineView[],
  shippingMethod: ShippingMethod | undefined,
  voucher: Voucher | undefined,
  fallbackCurrency: Currency,
): OrderTotals {
  const currency = lines[0]?.unitPrice.currency ?? fallbackCurrency;
  const subtotal = sum(lines.map(lineTotal), currency);
  // Nothing to ship → no fee. The interim mock shipping fees are VND-only: a fee in another
  // currency than the cart's is not charged (the server prices shipping at checkout, T5.1).
  const shipping =
    shippingMethod && lines.length > 0 && shippingMethod.fee.currency === currency
      ? sum([shippingMethod.fee], currency)
      : zero(currency);
  const discount = voucherDiscount(voucher, subtotal);
  const gross = sum([subtotal, shipping], currency);
  const net = subtract(gross, discount);
  return {
    itemCount: cartItemCount(lines),
    subtotal,
    shipping,
    discount,
    // A discount can never push the total below zero.
    total: isNegative(net) ? zero(currency) : net,
  };
}
