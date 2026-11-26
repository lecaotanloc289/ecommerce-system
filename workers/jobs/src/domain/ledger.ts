import type { LedgerAccount, Money } from '@repo/core';
import { assertZeroSum, toDbAmount, type LedgerEntryType, type Prisma } from '@repo/db';
import { ulid } from 'ulid';
import type { Tx } from '../outbox/handler';

export interface Posting {
  account: LedgerAccount;
  /** Signed: negative = debit out of the account. */
  amount: Money;
  /** Set on `VENDOR_WALLET` postings only. */
  vendorId?: string;
}

/** One ledger txn group (one `txnGroupId`) for a sub-order or order. */
export function ledgerGroup(
  postings: readonly Posting[],
  entryType: LedgerEntryType,
  orderId: string,
  subOrderId: string | null,
): Prisma.LedgerEntryCreateManyInput[] {
  const txnGroupId = ulid();
  return postings.map((p) => ({
    id: ulid(),
    txnGroupId,
    account: p.account,
    entryType,
    amount: toDbAmount(p.amount),
    currency: p.amount.currency,
    orderId,
    subOrderId,
    vendorId: p.vendorId ?? null,
  }));
}

/** `assertZeroSum` per group, then one `createMany`. Empty input writes nothing. */
export async function insertLedger(
  tx: Tx,
  rows: readonly Prisma.LedgerEntryCreateManyInput[],
): Promise<void> {
  if (rows.length === 0) return;
  assertZeroSum(rows.map((r) => ({ txnGroupId: r.txnGroupId, amount: BigInt(r.amount) })));
  await tx.ledgerEntry.createMany({ data: [...rows] });
}
