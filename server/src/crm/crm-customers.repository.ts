import { Injectable } from '@nestjs/common';
import {
  type CrmAudienceFilter,
  type Currency,
  CurrencySchema,
  type CustomerSegment,
  CustomerSegmentSchema,
  type CustomerSegmentThresholds,
  DomainError,
  type Money,
  type SubOrderStatus,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';

/**
 * "Valid orders" (C1): the sub-order statuses that make a user a customer of the vendor and count
 * in every CRM statistic. REFUNDED, CANCELLED and AWAITING_PAYMENT never count. The SQL below
 * spells the same list out (a tagged template cannot splice an array into `IN (…)` literally).
 */
export const CRM_VALID_SUB_ORDER_STATUSES: readonly SubOrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
];

const MS_PER_DAY = 86_400_000;

export type CrmCustomerSort = 'last_order' | 'order_count';

/** Keyset position: the last row of the previous page under the active sort. */
export type CrmCustomerKey =
  | { sort: 'last_order'; lastOrderAt: Date; customerId: string }
  | { sort: 'order_count'; orderCount: number; customerId: string };

/** Every criterion is optional; an absent / empty one does not filter. */
export interface CrmCustomerFilter {
  customerId?: string | undefined;
  /** Any of these segments. */
  segments?: readonly CustomerSegment[] | undefined;
  /** Has at least one of these tags. */
  tags?: readonly string[] | undefined;
  /** Bought at least one of these products in a valid order of this vendor. */
  productIds?: readonly string[] | undefined;
  /** Substring of the customer's name (case-insensitive) or the exact customer id. */
  q?: string | undefined;
}

export interface CrmCustomerPageArgs {
  sort: CrmCustomerSort;
  after: CrmCustomerKey | null;
  /** Page size (callers pass `limit + 1` to detect a next page). Always bounded. */
  limit: number;
}

/** One customer of the vendor with stats computed on read (C1–C3). Never email / phone / address. */
export interface CrmCustomerRow {
  customerId: string;
  name: string;
  avatarUrl: string | null;
  orderCount: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  segment: CustomerSegment;
  tags: string[];
  marketingOptIn: boolean;
  serviceOptOut: boolean;
}

export interface CrmSegmentCountRow {
  segment: CustomerSegment;
  customers: number;
  marketingOptedIn: number;
}

/** An eligible campaign recipient (vendor customer ∩ filter ∩ marketing consent). */
export interface CrmAudienceRecipient {
  userId: string;
}

export interface CrmAudienceCounts {
  /** Customers matching the filter. */
  matched: number;
  /** …of which have marketing consent (would receive the campaign). */
  eligible: number;
}

interface RawCustomerRow {
  customer_id: string;
  name: string;
  avatar_url: string | null;
  order_count: number;
  first_order_at: Date;
  last_order_at: Date;
  segment: string;
  tags: string[];
  marketing_opt_in: boolean;
  service_opt_out: boolean;
}

/** Segment cut-offs as instants: elapsed > N days ⟺ lastOrderAt < now − N days (strict, like `classifyCustomer`). */
function cutoffs(now: Date, thresholds: CustomerSegmentThresholds) {
  return {
    lapsed: new Date(now.getTime() - thresholds.lapsedAfterDays * MS_PER_DAY).toISOString(),
    atRisk: new Date(now.getTime() - thresholds.atRiskAfterDays * MS_PER_DAY).toISOString(),
    vipMinOrders: thresholds.vipMinOrders,
  };
}

const nonEmpty = <T>(xs: readonly T[] | undefined): T[] | null =>
  xs !== undefined && xs.length > 0 ? [...xs] : null;

/** `%q%` for ILIKE with the LIKE wildcards of the user input escaped. */
const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Bound parameters of the campaign audience filter (C10); empty criteria → null (no filter). */
function audienceParams(filter: CrmAudienceFilter, now: Date) {
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
 * Compute-on-read CRM statistics (decision C1) over `sub_orders ⋈ orders`, scoped to one vendor.
 *
 * Every query is ONE `$queryRaw` tagged template: all values (vendor id, filters, cursor, dates)
 * are bound parameters, never concatenated. Optional filters are written `(${x} IS NULL OR …)`.
 * (`Prisma` is type-only in `@repo/db`, so `Prisma.sql` fragments cannot be composed here.)
 *
 * Instants are passed as ISO-8601 UTC strings and compared as
 * `${iso}::timestamptz AT TIME ZONE 'UTC'` against the `timestamp(3)` columns (which hold UTC),
 * so the result does not depend on the session time zone.
 *
 * Segment SQL ⇔ `classifyCustomer` (core): LAPSED if `last_order_at < now − lapsed days`, else
 * AT_RISK if `< now − atRisk days`, else VIP if `order_count ≥ vipMinOrders`, else RETURNING if
 * `≥ 2`, else NEW — the same strict millisecond comparison (`elapsed > N·86400000 ms`). The same
 * CASE appears in `customers`, `segmentCounts`, `audienceIds` and `audienceCounts`;
 * `test/integration/crm.spec.ts` checks every one of them against `classifyCustomer`.
 */
@Injectable()
export class CrmCustomersRepository {
  /** `PlatformSettings` segment thresholds (C3). */
  async thresholds(db: Prisma.TransactionClient): Promise<CustomerSegmentThresholds> {
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

  /** True iff the user has at least one valid sub-order of the vendor (C1). */
  async isCustomer(
    db: Prisma.TransactionClient,
    vendorId: string,
    customerId: string,
  ): Promise<boolean> {
    const rows = await db.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM sub_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.vendor_id = ${vendorId} AND o.customer_id = ${customerId}
          AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
      ) AS found`;
    return rows[0]?.found === true;
  }

  /**
   * One page of customers of the vendor matching `filter`, keyset-ordered by
   * `(sortKey DESC, customerId DESC)`. Province and spend are read separately for the page only.
   */
  async customers(
    db: Prisma.TransactionClient,
    vendorId: string,
    filter: CrmCustomerFilter,
    page: CrmCustomerPageArgs,
    now: Date,
    thresholds: CustomerSegmentThresholds,
  ): Promise<CrmCustomerRow[]> {
    const cut = cutoffs(now, thresholds);
    const customerId = filter.customerId ?? null;
    const segments = nonEmpty(filter.segments);
    const tags = nonEmpty(filter.tags);
    const productIds = nonEmpty(filter.productIds);
    const q = filter.q !== undefined && filter.q.length > 0 ? filter.q : null;
    const pattern = q === null ? null : likePattern(q);
    const sort = page.sort;
    const after = page.after;
    const afterTs = after?.sort === 'last_order' ? after.lastOrderAt.toISOString() : null;
    const afterCount = after?.sort === 'order_count' ? after.orderCount : null;
    const afterId = after?.customerId ?? null;

    const rows = await db.$queryRaw<RawCustomerRow[]>`
      WITH valid AS (
        SELECT so.id, o.customer_id, so.created_at
        FROM sub_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.vendor_id = ${vendorId}
          AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
      ),
      stats AS (
        SELECT customer_id,
               COUNT(*)::int AS order_count,
               MIN(created_at) AS first_order_at,
               MAX(created_at) AS last_order_at
        FROM valid GROUP BY customer_id
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
      SELECT c.customer_id, u.name, u.avatar_url,
        c.order_count, c.first_order_at, c.last_order_at, c.segment,
        COALESCE(vc.tags, ARRAY[]::text[]) AS tags,
        COALESCE(p.marketing_opt_in_at IS NOT NULL
          AND (p.marketing_opt_out_at IS NULL OR p.marketing_opt_in_at > p.marketing_opt_out_at),
          false) AS marketing_opt_in,
        COALESCE(p.service_opt_out_at IS NOT NULL, false) AS service_opt_out
      FROM classified c
      JOIN users u ON u.id = c.customer_id
      LEFT JOIN vendor_customers vc ON vc.vendor_id = ${vendorId} AND vc.user_id = c.customer_id
      LEFT JOIN customer_vendor_preferences p
        ON p.vendor_id = ${vendorId} AND p.user_id = c.customer_id
      WHERE (${customerId}::text IS NULL OR c.customer_id = ${customerId}::text)
        AND (${segments}::text[] IS NULL OR c.segment = ANY(${segments}::text[]))
        AND (${tags}::text[] IS NULL OR vc.tags && ${tags}::text[])
        AND (${productIds}::text[] IS NULL OR EXISTS (
          SELECT 1 FROM valid v
          JOIN order_items oi ON oi.sub_order_id = v.id
          JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE v.customer_id = c.customer_id AND pv.product_id = ANY(${productIds}::text[])))
        AND (${q}::text IS NULL OR u.name ILIKE ${pattern}::text OR c.customer_id = ${q}::text)
        AND (${sort}::text <> 'last_order' OR ${afterTs}::timestamptz IS NULL
          OR (c.last_order_at, c.customer_id)
             < ((${afterTs}::timestamptz AT TIME ZONE 'UTC'), ${afterId}::text))
        AND (${sort}::text <> 'order_count' OR ${afterCount}::int IS NULL
          OR (c.order_count, c.customer_id) < (${afterCount}::int, ${afterId}::text))
      ORDER BY
        CASE WHEN ${sort}::text = 'order_count' THEN c.order_count ELSE 0 END DESC,
        CASE WHEN ${sort}::text = 'last_order' THEN c.last_order_at END DESC,
        c.customer_id DESC
      LIMIT ${page.limit}::int`;

    return rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      avatarUrl: r.avatar_url,
      orderCount: r.order_count,
      firstOrderAt: r.first_order_at,
      lastOrderAt: r.last_order_at,
      segment: CustomerSegmentSchema.parse(r.segment),
      tags: r.tags,
      marketingOptIn: r.marketing_opt_in,
      serviceOptOut: r.service_opt_out,
    }));
  }

  /**
   * Province per customer = `city` of the latest valid sub-order's shipping-address snapshot
   * (province level in VN; never the street address). Only for the given (page) customers.
   */
  async provinces(
    db: Prisma.TransactionClient,
    vendorId: string,
    customerIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    if (customerIds.length === 0) return new Map();
    const rows = await db.$queryRaw<{ customer_id: string; province: string | null }[]>`
      SELECT DISTINCT ON (o.customer_id) o.customer_id, so.shipping_address ->> 'city' AS province
      FROM sub_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.vendor_id = ${vendorId}
        AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
        AND o.customer_id = ANY(${[...customerIds]}::text[])
      ORDER BY o.customer_id, so.created_at DESC, so.id DESC`;
    return new Map(rows.map((r) => [r.customer_id, r.province]));
  }

  /** Per-segment customer + opted-in counts (all five segments, zero-filled, in enum order). */
  async segmentCounts(
    db: Prisma.TransactionClient,
    vendorId: string,
    now: Date,
    thresholds: CustomerSegmentThresholds,
  ): Promise<CrmSegmentCountRow[]> {
    const cut = cutoffs(now, thresholds);
    const rows = await db.$queryRaw<
      { segment: string; customers: number; marketing_opted_in: number }[]
    >`
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
      SELECT c.segment,
        COUNT(*)::int AS customers,
        (COUNT(*) FILTER (WHERE p.marketing_opt_in_at IS NOT NULL
          AND (p.marketing_opt_out_at IS NULL OR p.marketing_opt_in_at > p.marketing_opt_out_at)
        ))::int AS marketing_opted_in
      FROM classified c
      LEFT JOIN customer_vendor_preferences p
        ON p.vendor_id = ${vendorId} AND p.user_id = c.customer_id
      GROUP BY c.segment`;

    const bySegment = new Map(rows.map((r) => [r.segment, r]));
    return CustomerSegmentSchema.options.map((segment) => ({
      segment,
      customers: bySegment.get(segment)?.customers ?? 0,
      marketingOptedIn: bySegment.get(segment)?.marketing_opted_in ?? 0,
    }));
  }

  /** Σ paid_i (C2: subtotal + shipping − discount − platformDiscount) on valid orders, per currency. */
  async spend(
    db: Prisma.TransactionClient,
    vendorId: string,
    customerIds: readonly string[],
  ): Promise<Map<string, Money[]>> {
    const result = new Map<string, Money[]>();
    if (customerIds.length === 0) return result;
    const rows = await db.$queryRaw<{ customer_id: string; currency: string; paid: bigint }[]>`
      SELECT o.customer_id, so.currency::text AS currency,
        SUM(so.subtotal_amount + so.shipping_amount - so.discount_amount
            - so.platform_discount_amount)::bigint AS paid
      FROM sub_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.vendor_id = ${vendorId}
        AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
        AND o.customer_id = ANY(${[...customerIds]}::text[])
      GROUP BY o.customer_id, so.currency
      ORDER BY so.currency::text`;
    for (const row of rows) {
      const currency: Currency = CurrencySchema.parse(row.currency);
      const list = result.get(row.customer_id) ?? [];
      list.push(toMoney(row.paid, currency));
      result.set(row.customer_id, list);
    }
    return result;
  }

  /**
   * Ids of eligible recipients (vendor customer ∩ filter ∩ marketing consent), lean: no names,
   * tags, province or spend. `limit` null = all (K5 batches them), 1 = existence check.
   */
  async audienceIds(
    db: Prisma.TransactionClient,
    vendorId: string,
    filter: CrmAudienceFilter,
    now: Date,
    thresholds: CustomerSegmentThresholds,
    limit: number | null,
  ): Promise<string[]> {
    const cut = cutoffs(now, thresholds);
    const f = audienceParams(filter, now);
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

  /** Audience size for the preview: one aggregate row, nothing materialised per customer. */
  async audienceCounts(
    db: Prisma.TransactionClient,
    vendorId: string,
    filter: CrmAudienceFilter,
    now: Date,
  ): Promise<CrmAudienceCounts> {
    const cut = cutoffs(now, await this.thresholds(db));
    const f = audienceParams(filter, now);
    const rows = await db.$queryRaw<{ matched: number; eligible: number }[]>`
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
      SELECT COUNT(*)::int AS matched,
        (COUNT(*) FILTER (WHERE p.marketing_opt_in_at IS NOT NULL
          AND (p.marketing_opt_out_at IS NULL OR p.marketing_opt_in_at > p.marketing_opt_out_at)
        ))::int AS eligible
      FROM classified c
      LEFT JOIN customer_vendor_preferences p
        ON p.vendor_id = ${vendorId} AND p.user_id = c.customer_id
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
          OR c.last_order_at >= (${f.since}::timestamptz AT TIME ZONE 'UTC'))`;
    return { matched: rows[0]?.matched ?? 0, eligible: rows[0]?.eligible ?? 0 };
  }

  /**
   * Eligible recipients of a campaign audience at `now` (C10): customers of the vendor (C1) that
   * match the filter AND have marketing consent (C5). Works inside a transaction — used by the CRM
   * worker (K5) at send time. Vendor ACTIVE is the caller's check.
   */
  async resolveAudience(
    tx: Prisma.TransactionClient,
    vendorId: string,
    filter: CrmAudienceFilter,
    now: Date,
  ): Promise<CrmAudienceRecipient[]> {
    const ids = await this.audienceIds(tx, vendorId, filter, now, await this.thresholds(tx), null);
    return ids.map((userId) => ({ userId }));
  }

  /** At least one eligible recipient right now (schedule check; stops at the first match). */
  async hasEligibleAudience(
    tx: Prisma.TransactionClient,
    vendorId: string,
    filter: CrmAudienceFilter,
    now: Date,
  ): Promise<boolean> {
    const ids = await this.audienceIds(tx, vendorId, filter, now, await this.thresholds(tx), 1);
    return ids.length > 0;
  }
}
