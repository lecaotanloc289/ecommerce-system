import type { Prisma } from '@prisma/client';
import { DomainError, type CrmAudienceFilter, type CustomerSegmentThresholds } from '@repo/core';

// Vendor CRM queries shared by the API (`server/src/crm`) and the CRM worker (`@workers/jobs`).
// They live here because the worker cannot import `server/`: one copy of the audience SQL instead
// of a mirror that could drift. Rules: docs/superpowers/plans/2026-11-23-vendor-crm.md (C1, C3,
// C5, C10).

const MS_PER_DAY = 86_400_000;

type Db = Prisma.TransactionClient;

/** `PlatformSettings` segment thresholds (C3), from the oldest settings row (like the API). */
export async function crmSegmentThresholds(db: Db): Promise<CustomerSegmentThresholds> {
  const settings = await db.platformSettings.findFirst({
    orderBy: { id: 'asc' },
    select: { crmAtRiskAfterDays: true, crmLapsedAfterDays: true, crmVipMinOrders: true },
  });
  if (!settings) throw new DomainError('common.error.internal', { reason: 'settings-missing' });
  return {
    atRiskAfterDays: settings.crmAtRiskAfterDays,
    lapsedAfterDays: settings.crmLapsedAfterDays,
    vipMinOrders: settings.crmVipMinOrders,
  };
}

/**
 * Segment cut-offs as ISO instants: elapsed > N days ⟺ lastOrderAt < now − N days (strict, like
 * core `classifyCustomer`).
 */
export function crmSegmentCutoffs(now: Date, thresholds: CustomerSegmentThresholds) {
  return {
    lapsed: new Date(now.getTime() - thresholds.lapsedAfterDays * MS_PER_DAY).toISOString(),
    atRisk: new Date(now.getTime() - thresholds.atRiskAfterDays * MS_PER_DAY).toISOString(),
    vipMinOrders: thresholds.vipMinOrders,
  };
}

const nonEmpty = <T>(xs: readonly T[] | undefined): T[] | null =>
  xs !== undefined && xs.length > 0 ? [...xs] : null;

/** Bound parameters of the campaign audience filter (C10); empty criteria → null (no filter). */
export function crmAudienceParams(filter: CrmAudienceFilter, now: Date) {
  return {
    segments: nonEmpty(filter.segments),
    tags: nonEmpty(filter.tags),
    productIds: nonEmpty(filter.boughtProductIds),
    since:
      filter.lastOrderWithinDays === null
        ? null
        : new Date(now.getTime() - filter.lastOrderWithinDays * MS_PER_DAY).toISOString(),
  };
}

/**
 * Ids of eligible campaign recipients at `now`: customers of the vendor (≥ 1 valid sub-order:
 * PAID..COMPLETED, C1) matching the filter (segments ANY, tags ANY, bought ANY product in a valid
 * order, last order within N days) AND with marketing consent (C5). Lean: ids only, ordered by id.
 * `limit` null = all, 1 = existence check. Vendor ACTIVE is the caller's check.
 *
 * The segment CASE must stay identical to core `classifyCustomer` and to the three other copies in
 * `server/src/crm/crm-customers.repository.ts` (`server/test/integration/crm.spec.ts` checks all of
 * them on the boundaries). Instants are bound as ISO strings compared `AT TIME ZONE 'UTC'` (the
 * columns are UTC `timestamp(3)`), so the result does not depend on the session time zone.
 */
export async function crmAudienceIds(
  db: Db,
  vendorId: string,
  filter: CrmAudienceFilter,
  now: Date,
  thresholds: CustomerSegmentThresholds,
  limit: number | null,
): Promise<string[]> {
  const cut = crmSegmentCutoffs(now, thresholds);
  const f = crmAudienceParams(filter, now);
  const rows = await db.$queryRaw<{ customer_id: string }[]>`
    WITH stats AS (
      SELECT o.customer_id, COUNT(*)::int AS order_count, MAX(so.created_at) AS last_order_at
      FROM sub_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.vendor_id = ${vendorId}
        AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
      GROUP BY o.customer_id
    ),
    classified AS (
      SELECT s.*,
        CASE
          WHEN s.last_order_at < (${cut.lapsed}::timestamptz AT TIME ZONE 'UTC') THEN 'LAPSED'
          WHEN s.last_order_at < (${cut.atRisk}::timestamptz AT TIME ZONE 'UTC') THEN 'AT_RISK'
          WHEN s.order_count >= ${cut.vipMinOrders}::int THEN 'VIP'
          WHEN s.order_count >= 2 THEN 'RETURNING'
          ELSE 'NEW'
        END AS segment
      FROM stats s
    )
    SELECT c.customer_id
    FROM classified c
    JOIN customer_vendor_preferences p
      ON p.vendor_id = ${vendorId} AND p.user_id = c.customer_id
     AND p.marketing_opt_in_at IS NOT NULL
     AND (p.marketing_opt_out_at IS NULL OR p.marketing_opt_in_at > p.marketing_opt_out_at)
    LEFT JOIN vendor_customers vc ON vc.vendor_id = ${vendorId} AND vc.user_id = c.customer_id
    WHERE (${f.segments}::text[] IS NULL OR c.segment = ANY(${f.segments}::text[]))
      AND (${f.tags}::text[] IS NULL OR vc.tags && ${f.tags}::text[])
      AND (${f.productIds}::text[] IS NULL OR EXISTS (
        SELECT 1 FROM sub_orders so2
        JOIN orders o2 ON o2.id = so2.order_id
        JOIN order_items oi ON oi.sub_order_id = so2.id
        JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE so2.vendor_id = ${vendorId} AND o2.customer_id = c.customer_id
          AND so2.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
          AND pv.product_id = ANY(${f.productIds}::text[])))
      AND (${f.since}::timestamptz IS NULL
        OR c.last_order_at >= (${f.since}::timestamptz AT TIME ZONE 'UTC'))
    ORDER BY c.customer_id
    LIMIT ${limit}::int`;
  return rows.map((r) => r.customer_id);
}
