import { describe, it, expect } from 'vitest';
import { assertZeroSum } from '../src/ledger.js';

describe('ledger zero-sum invariant', () => {
  it('accepts a balanced checkout posting (CUSTOMER -X / ESCROW +X)', () => {
    const g = 'grp_checkout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000n },
      { txnGroupId: g, amount: 199_000n },
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('accepts a balanced payout split (ESCROW -Y / WALLET +(Y-c) / REVENUE +c)', () => {
    const g = 'grp_payout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000n },
      { txnGroupId: g, amount: 179_100n }, // 90%
      { txnGroupId: g, amount: 19_900n }, // 10% commission
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('sums exactly beyond Number.MAX_SAFE_INTEGER', () => {
    const g = 'grp_big';
    const big = 9_007_199_254_740_993n; // 2^53 + 1 — not representable as a JS number
    expect(() =>
      assertZeroSum([
        { txnGroupId: g, amount: -big },
        { txnGroupId: g, amount: big - 1n },
        { txnGroupId: g, amount: 1n },
      ]),
    ).not.toThrow();
    expect(() =>
      assertZeroSum([
        { txnGroupId: g, amount: -big },
        { txnGroupId: g, amount: big - 1n },
      ]),
    ).toThrow(/sums to -1,/);
  });

  it('throws when a group does not net to zero', () => {
    const g = 'grp_bad';
    const entries = [
      { txnGroupId: g, amount: -199_000n },
      { txnGroupId: g, amount: 198_000n },
    ];
    expect(() => assertZeroSum(entries)).toThrow(/sums to -1000/);
  });
});
