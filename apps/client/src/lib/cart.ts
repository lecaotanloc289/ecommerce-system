import type { CartLine, Currency, Money, ShippingMethod, Voucher } from '../types';
import { sum } from '@repo/core/money';

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

/** unitPrice × qty, integer minor units. */
export function lineTotal(line: CartLine): Money {
  return { amount: line.unitPrice.amount * line.qty, currency: line.unitPrice.currency };
}

/** FIXED voucher discount, capped at the subtotal; zero when below its minimum spend. */
export function voucherDiscount(voucher: Voucher | undefined, subtotal: Money): Money {
  if (!voucher || voucher.amount.currency !== subtotal.currency) {
    return { amount: 0, currency: subtotal.currency };
  }
  if (subtotal.amount < voucher.minSubtotal.amount) {
    return { amount: 0, currency: subtotal.currency };
  }
  return { amount: Math.min(voucher.amount.amount, subtotal.amount), currency: subtotal.currency };
}

export interface OrderTotals {
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  discount: Money;
  total: Money;
}

/**
 * Single source of truth for cart/checkout totals. `sum` (@repo/core) throws if lines,
 * shipping, or discount mix currencies.
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
    shippingMethod && lines.length > 0
      ? sum([shippingMethod.fee], currency)
      : { amount: 0, currency };
  const discount = voucherDiscount(voucher, subtotal);
  const gross = sum([subtotal, shipping], currency);
  return {
    itemCount: cartItemCount(lines),
    subtotal,
    shipping,
    discount,
    // A discount can never push the total below zero.
    total: { amount: Math.max(0, gross.amount - discount.amount), currency },
  };
}
