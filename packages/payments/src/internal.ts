import { DomainError, type Currency, type Money, type PaymentProvider } from '@repo/core';

/** Throws unless `money.currency` is one the adapter supports. */
export function assertCurrency(
  provider: PaymentProvider,
  supported: readonly Currency[],
  money: Money,
): void {
  if (!supported.includes(money.currency)) {
    throw new DomainError('money.error.currency-mismatch', {
      provider,
      expected: supported.join(','),
      actual: money.currency,
    });
  }
}

/** Throws unless the amount is a positive safe integer (minor units). */
export function assertPositiveAmount(money: Money): void {
  if (!Number.isSafeInteger(money.amount) || money.amount <= 0) {
    throw new DomainError('money.error.invalid-operand', {
      field: 'amount',
      value: String(money.amount),
    });
  }
}

/** First value of a header/query entry; `undefined` when absent. Repeated keys are rejected by callers. */
export function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
