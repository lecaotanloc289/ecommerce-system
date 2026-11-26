import type { Currency } from '../enums';
import { DomainError } from '../errors';
import type { Money } from '../schemas/money';

// Money utility (Golden Rule #2). Every operation is integer-only: amounts are minor
// units, multipliers/ratios/bps are integers, and anything that could exceed 2^53 or
// needs division is computed in BigInt. No floating-point arithmetic anywhere.

export type { Money } from '../schemas/money';

/** Basis points in 100%. 1000 bps = 10%. */
export const BPS_DENOMINATOR = 10_000;

/**
 * How to resolve a fractional minor unit. Callers must always choose one explicitly.
 * - `floor` / `ceil` — toward −∞ / +∞
 * - `half-up`        — nearest; ties away from zero (commercial rounding)
 * - `half-even`      — nearest; ties to the even neighbour (banker's rounding)
 */
export type RoundingMode = 'floor' | 'ceil' | 'half-up' | 'half-even';

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new DomainError('money.error.non-integer', { field, value: String(value) });
  }
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError('money.error.currency-mismatch', {
      expected: a.currency,
      actual: b.currency,
    });
  }
}

function fromBigInt(amount: bigint, currency: Currency): Money {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new DomainError('money.error.overflow', { currency });
  }
  return { amount: Number(amount), currency };
}

/** Integer division of n / d (d > 0) with an explicit rounding mode. */
function divideRounded(n: bigint, d: bigint, mode: RoundingMode): bigint {
  const q = n / d; // BigInt division truncates toward zero
  const r = n % d; // remainder carries the sign of n
  if (r === 0n) return q;
  const sign = n < 0n ? -1n : 1n;
  switch (mode) {
    case 'floor':
      return sign < 0n ? q - 1n : q;
    case 'ceil':
      return sign > 0n ? q + 1n : q;
    case 'half-up':
    case 'half-even': {
      const twiceRem = 2n * (r < 0n ? -r : r);
      if (twiceRem > d) return q + sign;
      if (twiceRem < d) return q;
      if (mode === 'half-up') return q + sign;
      return q % 2n === 0n ? q : q + sign;
    }
  }
}

/** Build a Money value; throws `money.error.non-integer` for floats, NaN, ±Infinity, unsafe ints. */
export function of(amount: number, currency: Currency): Money {
  assertSafeInteger(amount, 'amount');
  return { amount, currency };
}

export function zero(currency: Currency): Money {
  return { amount: 0, currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  assertSafeInteger(a.amount, 'amount');
  assertSafeInteger(b.amount, 'amount');
  return fromBigInt(BigInt(a.amount) + BigInt(b.amount), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  assertSafeInteger(a.amount, 'amount');
  assertSafeInteger(b.amount, 'amount');
  return fromBigInt(BigInt(a.amount) - BigInt(b.amount), a.currency);
}

/** Sum a list of same-currency amounts. An empty list yields zero in `currency`. */
export function sum(items: readonly Money[], currency: Currency): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

/** Multiply by an integer (e.g. unit price × quantity). Fractional factors are rejected. */
export function multiply(m: Money, factor: number): Money {
  assertSafeInteger(m.amount, 'amount');
  assertSafeInteger(factor, 'factor');
  return fromBigInt(BigInt(m.amount) * BigInt(factor), m.currency);
}

/**
 * `m × bps / 10 000`, rounded with an explicit mode — e.g. commission:
 * `applyBps(subtotal, settings.commissionBps, 'half-up')`. `bps` must be an integer in
 * [0, 10 000]; values outside that range throw `money.error.invalid-operand`.
 */
export function applyBps(m: Money, bps: number, rounding: RoundingMode): Money {
  assertSafeInteger(m.amount, 'amount');
  assertSafeInteger(bps, 'bps');
  if (bps < 0 || bps > BPS_DENOMINATOR) {
    throw new DomainError('money.error.invalid-operand', { field: 'bps', value: bps });
  }
  const scaled = divideRounded(BigInt(m.amount) * BigInt(bps), BigInt(BPS_DENOMINATOR), rounding);
  return fromBigInt(scaled, m.currency);
}

/**
 * Split `m` proportionally to integer `ratios` without creating or losing a single
 * minor unit: the parts always sum exactly to `m`. Uses the largest-remainder method —
 * each part gets floor(m × ratio / total), then the leftover units go one each to the
 * parts with the largest fractional remainder (ties → lower index). A zero ratio always
 * receives zero. Negative amounts are split symmetrically (allocate |m|, then negate).
 *
 * @example allocate(of(100, 'VND'), [1, 1, 1]) → [34, 33, 33]
 */
export function allocate(m: Money, ratios: readonly number[]): Money[] {
  assertSafeInteger(m.amount, 'amount');
  if (ratios.length === 0) {
    throw new DomainError('money.error.invalid-operand', { field: 'ratios', reason: 'empty' });
  }
  for (const ratio of ratios) {
    assertSafeInteger(ratio, 'ratio');
    if (ratio < 0) {
      throw new DomainError('money.error.invalid-operand', { field: 'ratio', value: ratio });
    }
  }
  const total = ratios.reduce((acc, ratio) => acc + BigInt(ratio), 0n);
  if (total === 0n) {
    throw new DomainError('money.error.invalid-operand', { field: 'ratios', reason: 'zero-sum' });
  }

  const negative = m.amount < 0;
  const absAmount = negative ? -BigInt(m.amount) : BigInt(m.amount);
  const parts = ratios.map((ratio, index) => {
    const exact = absAmount * BigInt(ratio);
    return { index, share: exact / total, remainder: exact % total };
  });

  let leftover = absAmount - parts.reduce((acc, p) => acc + p.share, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (leftover === 0n) break;
    part.share += 1n;
    leftover -= 1n;
  }

  return parts.map((p) => fromBigInt(negative ? -p.share : p.share, m.currency));
}

/** -1 / 0 / 1. Throws on currency mismatch — amounts in different currencies are not comparable. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount === b.amount) return 0;
  return a.amount < b.amount ? -1 : 1;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function isNegative(m: Money): boolean {
  return m.amount < 0;
}
