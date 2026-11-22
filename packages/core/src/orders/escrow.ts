import type { LedgerAccount } from '../enums';
import { DomainError } from '../errors';
import * as M from '../money';
import type { Money } from '../schemas/money';

// Escrow money of one sub-order (roadmap D3, D7, D12), as pure functions shared by the API
// (payment confirmation, T3.1) and the worker (zero-amount confirmation, refunds) so the ledger
// is posted the same way everywhere. Callers write each posting pair as ONE ledger txn group
// (one `txnGroupId` per sub-order) and run `assertZeroSum` (`@repo/db`) before inserting.

/** The money columns of a `SubOrder` (`subtotal/shipping/discount/platformDiscountAmount`). */
export interface SubOrderCharges {
  subtotal: Money;
  shipping: Money;
  /** `SubOrder.discountAmount` — vendor-funded discount. */
  vendorDiscount: Money;
  /** `SubOrder.platformDiscountAmount` — this sub-order's share of platform coupons. */
  platformDiscount: Money;
}

/**
 * What the customer paid for one sub-order (D7):
 * `paid_i = subtotal + shipping − vendorDiscount − platformDiscount`. The order's grand total is
 * the sum over its sub-orders. Throws `money.error.invalid-operand` if negative (corrupt row).
 */
export function subOrderPaid(so: SubOrderCharges): Money {
  const paid = M.subtract(
    M.subtract(M.add(so.subtotal, so.shipping), so.vendorDiscount),
    so.platformDiscount,
  );
  if (M.isNegative(paid)) {
    throw new DomainError('money.error.invalid-operand', { reason: 'negative sub-order paid' });
  }
  return paid;
}

export interface EscrowPosting {
  account: Extract<LedgerAccount, 'CUSTOMER' | 'PLATFORM_ESCROW'>;
  /** Signed: negative = debit out of the account. */
  amount: Money;
}

function pair(
  from: EscrowPosting['account'],
  to: EscrowPosting['account'],
  amount: Money,
): [EscrowPosting, EscrowPosting] {
  if (M.isNegative(amount)) {
    throw new DomainError('money.error.invalid-operand', { reason: 'negative escrow amount' });
  }
  return [
    { account: from, amount: M.subtract(M.zero(amount.currency), amount) },
    { account: to, amount },
  ];
}

/**
 * Escrow IN when a payment is confirmed (D3/D7), per sub-order: `CUSTOMER −paid_i`,
 * `PLATFORM_ESCROW +paid_i` (entry type `ESCROW_IN`). Skip the group when `paid_i` is 0.
 */
export function computeEscrowInPostings(paid: Money): [EscrowPosting, EscrowPosting] {
  return pair('CUSTOMER', 'PLATFORM_ESCROW', paid);
}

/**
 * Refund of a whole sub-order (D12): `PLATFORM_ESCROW −paid_i`, `CUSTOMER +paid_i`
 * (entry type `REFUND`), written with the `Refund` row.
 */
export function computeRefundPostings(paid: Money): [EscrowPosting, EscrowPosting] {
  return pair('PLATFORM_ESCROW', 'CUSTOMER', paid);
}
