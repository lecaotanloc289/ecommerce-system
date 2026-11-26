import { DomainError, Money, type Currency } from '@repo/core';

// Boundary between DB money (BIGINT columns → JS `bigint`) and @repo/core Money (number-based,
// safe-integer minor units). Repositories convert here so the rest of the code only sees core Money.

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

/** DB amount column + currency → core Money. Throws `money.error.overflow` beyond ±(2^53 − 1). */
export function toMoney(amount: bigint, currency: Currency): Money {
  if (amount > MAX_SAFE || amount < MIN_SAFE) {
    throw new DomainError('money.error.overflow', { currency, amount: amount.toString() });
  }
  return Money.of(Number(amount), currency);
}

/** core Money → value for a BIGINT amount column. Rejects non-safe-integer amounts. */
export function toDbAmount(money: Money): bigint {
  return BigInt(Money.of(money.amount, money.currency).amount);
}
