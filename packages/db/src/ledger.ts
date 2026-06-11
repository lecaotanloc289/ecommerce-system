import type { LedgerEntry } from '@prisma/client';

/**
 * Double-entry invariant: every posting in a txn group must net to zero.
 * Throws if any group's signed amounts do not sum to 0.
 */
export function assertZeroSum(entries: Pick<LedgerEntry, 'txnGroupId' | 'amount'>[]): void {
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (!Number.isInteger(e.amount)) {
      throw new Error(`Ledger amount must be an integer (smallest currency unit), got ${e.amount}`);
    }
    sums.set(e.txnGroupId, (sums.get(e.txnGroupId) ?? 0) + e.amount);
  }
  for (const [group, total] of sums) {
    if (total !== 0) {
      throw new Error(
        `Ledger invariant violated: txn_group_id=${group} sums to ${total}, expected 0`,
      );
    }
  }
}
