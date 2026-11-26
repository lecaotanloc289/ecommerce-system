import {
  CartLineSchema,
  CartVendorGroupSchema,
  MAX_CART_LINE_QUANTITY,
  type CartLineInput,
  type ProductDetail,
  type ProductVariant,
} from '@repo/core';
import { multiply, sum, zero } from '@repo/core/money';
import type { Currency, Money } from '../types';

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

/** A cart line resolved for display: guest `{ variantId, quantity }` + snapshot, or a server `CartLine`. */
export interface CartLineView extends CartItemSnapshot {
  quantity: number;
  /** Product or vendor no longer sellable (server cart only): greyed out, excluded from totals. */
  unavailable: boolean;
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

/** Would adding `item` put two currencies in one cart? (One order = one currency, roadmap D6.) */
export function mixesCurrency(
  existing: readonly { unitPrice: Money }[],
  item: { unitPrice: Money },
): boolean {
  return existing.some((i) => i.unitPrice.currency !== item.unitPrice.currency);
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

export interface OrderTotals {
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  discount: Money;
  total: Money;
}

/** Lines that count towards totals and checkout (unavailable ones are shown greyed out only). */
export function payableLines(lines: readonly CartLineView[]): CartLineView[] {
  return lines.filter((l) => !l.unavailable);
}

/**
 * Client-side ESTIMATE of cart/checkout totals (the server prices the real order at checkout:
 * coupons, fees, rounding). Only payable lines in the cart's first currency are summed; shipping
 * fees in another currency are ignored. All math goes through @repo/core Money.
 */
export function computeTotals(
  lines: readonly CartLineView[],
  shippingFees: readonly Money[],
  fallbackCurrency: Currency,
): OrderTotals {
  const payable = payableLines(lines);
  const currency = payable[0]?.unitPrice.currency ?? fallbackCurrency;
  const sameCurrency = payable.filter((l) => l.unitPrice.currency === currency);
  const subtotal = sum(sameCurrency.map(lineTotal), currency);
  const shipping = sum(
    shippingFees.filter((fee) => fee.currency === currency),
    currency,
  );
  const discount = zero(currency);
  return {
    itemCount: cartItemCount(sameCurrency),
    subtotal,
    shipping,
    discount,
    total: sum([subtotal, shipping], currency),
  };
}
