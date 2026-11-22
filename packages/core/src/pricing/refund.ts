import type { LedgerAccount } from '../enums';
import { DomainError } from '../errors';
import * as M from '../money';
import type { Money } from '../schemas/money';

// Refund money math (roadmap D12): the MVP refunds a WHOLE sub-order, i.e. exactly what the
// customer paid for it (`paid_i`, D7), out of the platform escrow.

/** The sub-order money columns (as Money) that make up what the customer paid for it. */
export interface RefundableSubOrder {
  subtotal: Money;
  shipping: Money;
  /** Vendor-funded discount (`SubOrder.discountAmount`). */
  vendorDiscount: Money;
  /** This sub-order's share of platform coupons (`SubOrder.platformDiscountAmount`). */
  platformDiscount: Money;
}

/**
 * Amount refunded for a sub-order = `paid_i = subtotal + shipping − vendorDiscount −
 * platformDiscount` (D7) — the same amount the payment confirmation moved into escrow for it.
 * May be 0 (free shipping + 100% coupons). Negative (corrupt row) or mixed currencies throw.
 */
export function refundAmount(so: RefundableSubOrder): Money {
  const paid = M.subtract(
    M.subtract(M.add(so.subtotal, so.shipping), so.vendorDiscount),
    so.platformDiscount,
  );
  if (M.isNegative(paid)) {
    throw new DomainError('common.error.internal', { reason: 'negative sub-order paid amount' });
  }
  return paid;
}

export interface RefundPosting {
  account: Extract<LedgerAccount, 'PLATFORM_ESCROW' | 'CUSTOMER'>;
  /** Signed: negative = debit out of the account. */
  amount: Money;
}

/**
 * Ledger postings of a refund (D12), one txn group: escrow gives back `paid`, the customer gets
 * it — the mirror of the escrow-IN group written when the payment was confirmed
 * (`CUSTOMER −paid`, `PLATFORM_ESCROW +paid`). Always sums to zero. `paid` must be ≥ 0.
 */
export function refundPostings(paid: Money): [RefundPosting, RefundPosting] {
  if (M.isNegative(paid)) {
    throw new DomainError('common.error.internal', { reason: 'negative refund amount' });
  }
  return [
    { account: 'PLATFORM_ESCROW', amount: M.subtract(M.zero(paid.currency), paid) },
    { account: 'CUSTOMER', amount: paid },
  ];
}
