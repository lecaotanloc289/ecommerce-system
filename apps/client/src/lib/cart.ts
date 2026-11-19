import type { CartLine, Currency, Money, ShippingMethod, Voucher } from '../types';
import { compare, isNegative, multiply, subtract, sum, zero } from '@repo/core/money';

/** Upper bound for a single line's quantity when stock is unknown. */
export const MAX_LINE_QTY = 99;

/** Stable identity of a cart line: one product + optional variant. */
export function cartLineKey(productId: string, variantId?: string): string {
  return `${productId}:${variantId ?? ''}`;
}

/** Number of items in the cart — the sum of quantities, not the number of lines. */
export function cartItemCount(lines: { qty: number }[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

/** unitPrice × qty, integer minor units (core `multiply` rejects fractional qty / overflow). */
export function lineTotal(line: CartLine): Money {
  return multiply(line.unitPrice, line.qty);
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
  lines: CartLine[],
  shippingMethod: ShippingMethod | undefined,
  voucher: Voucher | undefined,
  fallbackCurrency: Currency,
): OrderTotals {
  const currency = lines[0]?.unitPrice.currency ?? fallbackCurrency;
  const subtotal = sum(lines.map(lineTotal), currency);
  // Nothing to ship → no fee.
  const shipping =
    shippingMethod && lines.length > 0 ? sum([shippingMethod.fee], currency) : zero(currency);
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
