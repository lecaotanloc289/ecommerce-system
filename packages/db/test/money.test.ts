import { describe, it, expect } from 'vitest';
import { DomainError, type ErrorCode } from '@repo/core';
import { toDbAmount, toMoney } from '../src/money.js';

const MAX = Number.MAX_SAFE_INTEGER;

function errorCode(fn: () => unknown): ErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('toMoney (BIGINT column → core Money)', () => {
  it('converts zero, negative and safe-boundary amounts exactly', () => {
    expect(toMoney(0n, 'VND')).toEqual({ amount: 0, currency: 'VND' });
    expect(toMoney(-199_000n, 'VND')).toEqual({ amount: -199_000, currency: 'VND' });
    expect(toMoney(5_000_000_000n, 'VND').amount).toBe(5_000_000_000); // > int4, fits a safe int
    expect(toMoney(BigInt(MAX), 'USD').amount).toBe(MAX);
    expect(toMoney(-BigInt(MAX), 'USD').amount).toBe(-MAX);
  });

  it('throws money.error.overflow outside the safe-integer range', () => {
    expect(errorCode(() => toMoney(BigInt(MAX) + 1n, 'VND'))).toBe('money.error.overflow');
    expect(errorCode(() => toMoney(-BigInt(MAX) - 1n, 'VND'))).toBe('money.error.overflow');
  });
});

describe('toDbAmount (core Money → BIGINT column)', () => {
  it('converts to bigint and round-trips with toMoney', () => {
    expect(toDbAmount({ amount: 199_000, currency: 'VND' })).toBe(199_000n);
    expect(toDbAmount({ amount: -MAX, currency: 'USD' })).toBe(-BigInt(MAX));
    const money = { amount: 5_000_000_000, currency: 'VND' } as const;
    expect(toMoney(toDbAmount(money), money.currency)).toEqual(money);
  });

  it('rejects non-integer or unsafe amounts', () => {
    expect(errorCode(() => toDbAmount({ amount: 1.5, currency: 'VND' }))).toBe(
      'money.error.non-integer',
    );
    expect(errorCode(() => toDbAmount({ amount: MAX + 2, currency: 'VND' }))).toBe(
      'money.error.non-integer',
    );
  });
});
