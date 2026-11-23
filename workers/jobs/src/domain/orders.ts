import { prisma, type OrderStatus } from '@repo/db';
import type { Logger } from '../logger';
import type { Tx } from '../outbox/handler';

// Shared steps of the order writers the worker mirrors from the API (server CLAUDE.md "Orders",
// "Payments", "Fulfilment", "Refunds"). Every writer of order / sub-order state takes the ORDER
// row lock first, so it serialises with checkout, cancel, payment confirmation, fulfilment and
// refunds without a lock-order deadlock.
//
// Time: the columns are `timestamp(3)` WITHOUT time zone holding UTC (what Prisma writes), so
// the DB clock is read as `now() AT TIME ZONE 'UTC'` (as in the outbox dispatcher). Inside a
// transaction `now()` is the transaction start time.

export interface LockedOrder {
  id: string;
  customerId: string;
  status: OrderStatus;
  /** DB clock (UTC) at the start of this transaction — use it for every timestamp written. */
  dbNow: Date;
}

/** `SELECT … FROM orders WHERE id = $1 FOR UPDATE` — the first lock of every order writer. */
export async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrder | null> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, customer_id AS "customerId", status, (now() AT TIME ZONE 'UTC') AS "dbNow"
    FROM orders WHERE id = ${orderId} FOR UPDATE`;
  return rows[0] ?? null;
}

/** `orders.status = deriveOrderStatus(all sub-orders)` — callers pass the function from core. */
export async function subOrderStatuses(tx: Tx, orderId: string) {
  const rows = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });
  return rows.map((r) => r.status);
}

/** Σ quantity per variant, sorted by variant id (the order checkout reserves in: no deadlocks). */
export function quantitiesByVariant(
  items: readonly { variantId: string; quantity: number }[],
): [string, number][] {
  const qty = new Map<string, number>();
  for (const item of items) qty.set(item.variantId, (qty.get(item.variantId) ?? 0) + item.quantity);
  return [...qty].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface PlatformTunables {
  holdPeriodDays: number;
  refundWindowDays: number;
}

/** The platform settings row (oldest, like the API). Missing → throws: jobs cannot guess. */
export async function loadTunables(): Promise<PlatformTunables> {
  const settings = await prisma.platformSettings.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { holdPeriodDays: true, refundWindowDays: true },
  });
  if (!settings) throw new Error('platform settings row missing');
  return settings;
}

/**
 * D4 "paid": `stock_on_hand -= qty, stock_reserved -= qty` per variant in variant-id order,
 * guarded so neither counter goes negative; if the guard fails (should not happen) both are
 * clamped at 0 and the variant is logged for a manual stock check — mirror of the API's
 * `commitStock`.
 */
export async function commitStock(
  tx: Tx,
  orderId: string,
  items: readonly { variantId: string; quantity: number }[],
  log: Logger,
): Promise<void> {
  for (const [variantId, qty] of quantitiesByVariant(items)) {
    const updated = await tx.$executeRaw`
      UPDATE product_variants
      SET stock_on_hand = stock_on_hand - ${qty},
          stock_reserved = stock_reserved - ${qty},
          updated_at = now()
      WHERE id = ${variantId} AND stock_on_hand >= ${qty} AND stock_reserved >= ${qty}`;
    if (updated === 1) continue;
    log.error(
      { orderId, variantId, qty },
      'variant stock below the paid quantity; counters clamped at 0 — check stock manually',
    );
    await tx.$executeRaw`
      UPDATE product_variants
      SET stock_on_hand = GREATEST(stock_on_hand - ${qty}, 0),
          stock_reserved = GREATEST(stock_reserved - ${qty}, 0),
          updated_at = now()
      WHERE id = ${variantId}`;
  }
}
