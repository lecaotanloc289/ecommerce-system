import { describe, it, expect } from 'vitest';
import { assertZeroSum } from '../src/ledger.js';

describe('ledger zero-sum invariant', () => {
  it('accepts a balanced checkout posting (CUSTOMER -X / ESCROW +X)', () => {
    const g = 'grp_checkout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 199_000 },
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('accepts a balanced payout split (ESCROW -Y / WALLET +(Y-c) / REVENUE +c)', () => {
    const g = 'grp_payout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 179_100 }, // 90%
      { txnGroupId: g, amount: 19_900 }, // 10% commission
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('throws when a group does not net to zero', () => {
    const g = 'grp_bad';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 198_000 },
    ];
    expect(() => assertZeroSum(entries)).toThrow(/sums to -1000/);
  });
});
