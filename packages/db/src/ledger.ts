import type { LedgerEntry } from '@prisma/client';

/**
 * Double-entry invariant: every posting in a txn group must net to zero.
 * Amounts are BIGINT minor units (`bigint`), so the sum is exact at any size.
 * Throws if any group's signed amounts do not sum to 0.
 */
export function assertZeroSum(entries: Pick<LedgerEntry, 'txnGroupId' | 'amount'>[]): void {
  const sums = new Map<string, bigint>();
  for (const e of entries) {
    sums.set(e.txnGroupId, (sums.get(e.txnGroupId) ?? 0n) + e.amount);
  }
  for (const [group, total] of sums) {
    if (total !== 0n) {
      throw new Error(
        `Ledger invariant violated: txn_group_id=${group} sums to ${total}, expected 0`,
      );
    }
  }
}
