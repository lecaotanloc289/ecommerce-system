import { describe, expect, it } from 'vitest';
import { DomainError, type ErrorCode } from '../src/errors';
import {
  add,
  allocate,
  applyBps,
  compare,
  equals,
  isNegative,
  isZero,
  multiply,
  of,
  subtract,
  sum,
  zero,
  type Money,
  type RoundingMode,
} from '../src/money';

const vnd = (amount: number): Money => of(amount, 'VND');
const usd = (amount: number): Money => of(amount, 'USD');
const MAX = Number.MAX_SAFE_INTEGER;

function expectDomainError(fn: () => unknown, code: ErrorCode): DomainError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    if (error instanceof DomainError) {
      expect(error.code).toBe(code);
      return error;
    }
  }
  throw new Error(`expected DomainError ${code}, nothing was thrown`);
}

describe('of / zero', () => {
  it('accepts zero, positive and negative integers', () => {
    expect(of(0, 'VND')).toEqual({ amount: 0, currency: 'VND' });
    expect(of(150_000, 'VND').amount).toBe(150_000);
    expect(of(-250, 'USD')).toEqual({ amount: -250, currency: 'USD' });
    expect(of(MAX, 'VND').amount).toBe(MAX);
  });

  it.each([1.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, MAX + 1])('rejects %s', (amount) => {
    expectDomainError(() => of(amount, 'VND'), 'money.error.non-integer');
  });

  it('zero is zero in the given currency', () => {
    expect(zero('USD')).toEqual({ amount: 0, currency: 'USD' });
    expect(isZero(zero('VND'))).toBe(true);
    expect(isZero(vnd(1))).toBe(false);
  });
});

describe('add / subtract / sum', () => {
  it('adds and subtracts, crossing zero', () => {
    expect(add(vnd(100), vnd(50))).toEqual(vnd(150));
    expect(subtract(vnd(100), vnd(150))).toEqual(vnd(-50));
    expect(add(vnd(-50), vnd(50))).toEqual(vnd(0));
  });

  it('throws currency-mismatch with both currencies in params', () => {
    const error = expectDomainError(() => add(vnd(1), usd(1)), 'money.error.currency-mismatch');
    expect(error.params).toEqual({ expected: 'VND', actual: 'USD' });
    expectDomainError(() => subtract(usd(1), vnd(1)), 'money.error.currency-mismatch');
  });

  it('throws overflow instead of silently losing precision', () => {
    expectDomainError(() => add(vnd(MAX), vnd(1)), 'money.error.overflow');
    expectDomainError(() => subtract(vnd(-MAX), vnd(1)), 'money.error.overflow');
  });

  it('rejects a hand-built non-integer Money', () => {
    expectDomainError(
      () => add({ amount: 0.5, currency: 'VND' }, vnd(1)),
      'money.error.non-integer',
    );
  });

  it('sums a list; empty list is zero', () => {
    expect(sum([vnd(1), vnd(2), vnd(3)], 'VND')).toEqual(vnd(6));
    expect(sum([], 'USD')).toEqual(zero('USD'));
    expectDomainError(() => sum([vnd(1), usd(2)], 'VND'), 'money.error.currency-mismatch');
  });
});

describe('multiply', () => {
  it('multiplies by integers', () => {
    expect(multiply(vnd(25_000), 3)).toEqual(vnd(75_000));
    expect(multiply(vnd(25_000), 0)).toEqual(vnd(0));
    expect(multiply(usd(199), -2)).toEqual(usd(-398));
  });

  it('rejects fractional factors and overflow', () => {
    expectDomainError(() => multiply(vnd(100), 1.5), 'money.error.non-integer');
    expectDomainError(() => multiply(vnd(MAX), 2), 'money.error.overflow');
  });
});

describe('applyBps', () => {
  // 1000 bps (10%) of 12_345 = 1_234.5 → a tie, so every mode differs from at least one other.
  const cases: Array<[number, RoundingMode, number]> = [
    [12_345, 'floor', 1_234],
    [12_345, 'ceil', 1_235],
    [12_345, 'half-up', 1_235],
    [12_345, 'half-even', 1_234], // 1234 is even
    [12_355, 'half-even', 1_236], // 1235.5 → 1236 is even
    [12_346, 'half-even', 1_235], // 1234.6 — not a tie
    [12_344, 'half-up', 1_234], // 1234.4 — not a tie
    [-12_345, 'floor', -1_235],
    [-12_345, 'ceil', -1_234],
    [-12_345, 'half-up', -1_235], // ties away from zero
    [-12_345, 'half-even', -1_234],
    [-12_355, 'half-even', -1_236], // -1235.5, q = -1235 is odd → away from zero
    [-12_355, 'half-up', -1_236],
    [12_340, 'floor', 1_234], // exact — no rounding in any mode
    [12_340, 'ceil', 1_234],
  ];

  it.each(cases)('10%% of %i with %s → %i', (amount, mode, expected) => {
    expect(applyBps(vnd(amount), 1_000, mode)).toEqual(vnd(expected));
  });

  it('handles the 0 and 10 000 bps boundaries', () => {
    expect(applyBps(vnd(12_345), 0, 'ceil')).toEqual(vnd(0));
    expect(applyBps(vnd(12_345), 10_000, 'floor')).toEqual(vnd(12_345));
  });

  it('stays exact for amounts where amount × bps exceeds 2^53', () => {
    const expected = Number((BigInt(MAX) * 9_999n) / 10_000n);
    expect(applyBps(vnd(MAX), 9_999, 'floor').amount).toBe(expected);
  });

  it.each([-1, 10_001, 12.5])('rejects bps %s', (bps) => {
    const code: ErrorCode = Number.isInteger(bps)
      ? 'money.error.invalid-operand'
      : 'money.error.non-integer';
    expectDomainError(() => applyBps(vnd(100), bps, 'floor'), code);
  });
});

describe('allocate', () => {
  const amounts = (parts: Money[]): number[] => parts.map((p) => p.amount);

  it('splits evenly and gives the remainder to the earliest parts on ties', () => {
    expect(amounts(allocate(vnd(100), [1, 1, 1]))).toEqual([34, 33, 33]);
    expect(amounts(allocate(vnd(101), [1, 1, 1]))).toEqual([34, 34, 33]);
  });

  it('gives leftover units to the largest fractional remainders', () => {
    // 10 × 1/100 = 0.1, 10 × 99/100 = 9.9 → the leftover unit goes to the 9.9 part.
    expect(amounts(allocate(vnd(10), [1, 99]))).toEqual([0, 10]);
    // 1000 × 70/100 = 700, 1000 × 30/100 = 300 — exact.
    expect(amounts(allocate(vnd(1_000), [70, 30]))).toEqual([700, 300]);
    // 100 × [1,2,4]/7 = 14.28, 28.57, 57.14 → remainders 2/7, 4/7, 1/7 → leftover to the middle part
    // (a "first parts get the leftover" split would wrongly give [15, 28, 57]).
    expect(amounts(allocate(vnd(100), [1, 2, 4]))).toEqual([14, 29, 57]);
  });

  it('never gives anything to a zero ratio', () => {
    expect(amounts(allocate(vnd(7), [0, 1, 0, 1]))).toEqual([0, 4, 0, 3]);
  });

  it('splits negative amounts symmetrically', () => {
    expect(amounts(allocate(vnd(-100), [1, 1, 1]))).toEqual([-34, -33, -33]);
  });

  it('splits zero into zeros and keeps the currency', () => {
    const parts = allocate(usd(0), [1, 2]);
    expect(parts).toEqual([usd(0), usd(0)]);
  });

  it('always sums back to the original amount', () => {
    const ratioSets = [[1], [3, 7], [1, 1, 1, 1, 1, 1, 1], [5, 0, 13, 2], [9_999, 1]];
    const totals = [0, 1, 7, 99, 100_001, -12_345, MAX];
    for (const ratios of ratioSets) {
      for (const total of totals) {
        const parts = allocate(vnd(total), ratios);
        expect(parts).toHaveLength(ratios.length);
        expect(sum(parts, 'VND')).toEqual(vnd(total));
      }
    }
  });

  it('rejects empty, negative, fractional and all-zero ratios', () => {
    expectDomainError(() => allocate(vnd(100), []), 'money.error.invalid-operand');
    expectDomainError(() => allocate(vnd(100), [1, -1]), 'money.error.invalid-operand');
    expectDomainError(() => allocate(vnd(100), [0, 0]), 'money.error.invalid-operand');
    expectDomainError(() => allocate(vnd(100), [0.5, 0.5]), 'money.error.non-integer');
  });
});

describe('compare / equals / isNegative', () => {
  it('orders same-currency amounts', () => {
    expect(compare(vnd(1), vnd(2))).toBe(-1);
    expect(compare(vnd(2), vnd(2))).toBe(0);
    expect(compare(vnd(-1), vnd(-2))).toBe(1);
  });

  it('refuses to compare different currencies', () => {
    expectDomainError(() => compare(vnd(1), usd(1)), 'money.error.currency-mismatch');
  });

  it('equals requires the same amount and currency', () => {
    expect(equals(vnd(5), vnd(5))).toBe(true);
    expect(equals(vnd(5), usd(5))).toBe(false);
    expect(equals(vnd(5), vnd(6))).toBe(false);
  });

  it('isNegative', () => {
    expect(isNegative(vnd(-1))).toBe(true);
    expect(isNegative(vnd(0))).toBe(false);
  });
});
