import {
  computePayoutPostings,
  Money,
  ORDER_AGGREGATE_TYPE,
  PayoutReleasedEventSchema,
  subOrderNet,
  subOrderPaid,
} from '@repo/core';
import { prisma, toDbAmount, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { insertLedger, ledgerGroup, type Posting } from '../domain/ledger';
import { loadTunables, lockOrder } from '../domain/orders';
import type { Logger } from '../logger';
import type { Tx } from '../outbox/handler';
import { forEachCandidate, JOB_TX_OPTIONS, type ItemOutcome, type JobContext } from './run';

interface Candidate {
  id: string;
  orderId: string;
}

/**
 * `release-payouts`: COMPLETED sub-orders, not paid out yet, whose hold period has passed
 * (`completedAt + holdPeriodDays <= now`, DB clock) and that carry no PENDING/SUCCEEDED refund →
 * the vendor's net goes from escrow to its wallet, one transaction per sub-order.
 */
export async function releasePayouts(ctx: JobContext) {
  const { holdPeriodDays } = await loadTunables();
  return forEachCandidate<Candidate>(
    ctx,
    (afterId, limit) => prisma.$queryRaw<Candidate[]>`
      SELECT so.id, so.order_id AS "orderId" FROM sub_orders so
      WHERE so.status = 'COMPLETED'
        AND so.payout_released_at IS NULL
        AND so.completed_at + make_interval(days => ${holdPeriodDays}::int)
            <= (now() AT TIME ZONE 'UTC')
        AND NOT EXISTS (
          SELECT 1 FROM refunds r
          WHERE r.sub_order_id = so.id AND r.status IN ('PENDING', 'SUCCEEDED'))
        AND so.id > ${afterId}
      ORDER BY so.id
      LIMIT ${limit}::int`,
    (so) =>
      prisma.$transaction((tx) => releasePayout(tx, so, holdPeriodDays, ctx.log), JOB_TX_OPTIONS),
  );
}

/**
 * One payout (D7), in the caller's transaction:
 *
 * 1. Lock the ORDER row first (refunds / fulfilment / confirmation take the same first lock), so
 *    two concurrent runs — or a run and an admin refund — serialise here.
 * 2. Re-check under the lock: COMPLETED, `payout_released_at IS NULL`, hold passed (DB clock), no
 *    PENDING/SUCCEEDED refund. Otherwise `skipped` (the other run already paid it).
 * 3. Wallet must exist in the sub-order currency — else `skipped` + error log (needs a human).
 * 4. `payout_released_at = now` `WHERE … IS NULL AND status = 'COMPLETED'` (1 row or throw).
 * 5. Ledger group `PAYOUT_OUT` from `computePayoutPostings`: `PLATFORM_ESCROW −paid`,
 *    `VENDOR_WALLET +net` (vendorId set), `PLATFORM_REVENUE +(commission − platformDiscount)`;
 *    zero postings dropped; `assertZeroSum`.
 * 6. `UPDATE wallets SET balance_amount = balance_amount + net` (currency-guarded).
 * 7. Outbox `payout.released {subOrderId, vendorId}` (vendor email reads the ledger amount).
 */
export async function releasePayout(
  tx: Tx,
  ref: Candidate,
  holdPeriodDays: number,
  log: Logger,
): Promise<ItemOutcome> {
  const order = await lockOrder(tx, ref.orderId);
  if (!order) return 'skipped';
  const [check] = await tx.$queryRaw<{ due: boolean }[]>`
    SELECT (so.status = 'COMPLETED'
            AND so.payout_released_at IS NULL
            AND so.completed_at + make_interval(days => ${holdPeriodDays}::int)
                <= (now() AT TIME ZONE 'UTC')
            AND NOT EXISTS (
              SELECT 1 FROM refunds r
              WHERE r.sub_order_id = so.id AND r.status IN ('PENDING', 'SUCCEEDED'))) AS due
    FROM sub_orders so WHERE so.id = ${ref.id} AND so.order_id = ${ref.orderId}`;
  if (!check?.due) return 'skipped';

  const so = await tx.subOrder.findUniqueOrThrow({
    where: { id: ref.id },
    select: {
      vendorId: true,
      currency: true,
      subtotalAmount: true,
      shippingAmount: true,
      discountAmount: true,
      platformDiscountAmount: true,
      commissionAmount: true,
    },
  });
  const m = (amount: bigint) => toMoney(amount, so.currency);
  const charges = {
    subtotal: m(so.subtotalAmount),
    shipping: m(so.shippingAmount),
    vendorDiscount: m(so.discountAmount),
    platformDiscount: m(so.platformDiscountAmount),
    commission: m(so.commissionAmount),
  };
  const net = subOrderNet(charges);
  const postings: Posting[] = computePayoutPostings({
    paid: subOrderPaid(charges),
    net,
    commission: charges.commission,
    platformDiscount: charges.platformDiscount,
  })
    .filter((p) => !Money.isZero(p.amount))
    .map((p) => (p.account === 'VENDOR_WALLET' ? { ...p, vendorId: so.vendorId } : p));

  const wallet = await tx.wallet.findUnique({
    where: { vendorId: so.vendorId },
    select: { id: true, balanceCurrency: true },
  });
  if (!wallet || wallet.balanceCurrency !== so.currency) {
    log.error(
      {
        subOrderId: ref.id,
        vendorId: so.vendorId,
        currency: so.currency,
        walletCurrency: wallet?.balanceCurrency ?? null,
      },
      'payout skipped: vendor wallet missing or in another currency — resolve manually',
    );
    return 'skipped';
  }

  const marked = await tx.subOrder.updateMany({
    where: { id: ref.id, status: 'COMPLETED', payoutReleasedAt: null },
    data: { payoutReleasedAt: order.dbNow },
  });
  if (marked.count !== 1) throw new Error(`payout: sub-order ${ref.id} changed under the lock`);

  await insertLedger(tx, ledgerGroup(postings, 'PAYOUT_OUT', ref.orderId, ref.id));

  const credited = await tx.$executeRaw`
    UPDATE wallets
    SET balance_amount = balance_amount + ${toDbAmount(net)},
        updated_at = (now() AT TIME ZONE 'UTC')
    WHERE id = ${wallet.id} AND balance_currency = ${so.currency}::"Currency"`;
  if (credited !== 1) throw new Error(`payout: wallet ${wallet.id} changed under the lock`);

  await tx.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: ORDER_AGGREGATE_TYPE,
      aggregateId: ref.orderId,
      eventType: 'payout.released',
      payload: PayoutReleasedEventSchema.parse({ subOrderId: ref.id, vendorId: so.vendorId }),
    },
  });
  log.info({ subOrderId: ref.id, vendorId: so.vendorId, net }, 'payout released');
  return 'done';
}
