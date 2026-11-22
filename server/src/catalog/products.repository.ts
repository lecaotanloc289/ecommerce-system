import { Injectable } from '@nestjs/common';
import type { Currency, ProductSort } from '@repo/core';
import { PrismaService } from '../prisma/prisma.service';

export interface ProductIdFilters {
  /** Category ids to match (a category and its descendants); `null` = no category filter. */
  categoryIds: readonly string[] | null;
  vendorSlug: string | null;
  currency: Currency | null;
  minPrice: number | null;
  maxPrice: number | null;
  sort: ProductSort;
  cursor: string | null;
  /** Rows to fetch (page size + 1 look-ahead). */
  take: number;
}

interface IdRow {
  id: string;
}

/** Escapes `\`, `%` and `_` so user text is matched literally by `LIKE ... ESCAPE '\'`. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/** Lowercase, strip diacritics (incl. đ) and collapse separators to single spaces. */
export function foldForSlugMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Raw SQL for the two catalog queries Prisma cannot express (sort-key keyset pagination and
 * full-text/trigram search). Every value is a bound parameter of a `$queryRaw` tagged template —
 * never string concatenation. Both return product ids only; callers hydrate with Prisma.
 */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Visible (ACTIVE product of ACTIVE vendor) ids in sort order, keyset-paginated by `cursor`
   * (the last id of the previous page). One static query: `sort_key` is "smaller = earlier"
   * (0 / price / −price / −avg rating) with id DESC as the tiebreaker (newest first). If the
   * cursor product has since become hidden, the page is empty.
   */
  async listVisibleIds(f: ProductIdFilters): Promise<string[]> {
    const categoryIds = f.categoryIds === null ? null : [...f.categoryIds];
    const rows = await this.prisma.client.$queryRaw<IdRow[]>`
      WITH base AS (
        SELECT p.id,
          CASE ${f.sort}::text
            WHEN 'price_asc' THEN p.base_price_amount::numeric
            WHEN 'price_desc' THEN -p.base_price_amount::numeric
            WHEN 'rating' THEN -COALESCE(
              (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM reviews r WHERE r.product_id = p.id), 0)
            ELSE 0::numeric
          END AS sort_key
        FROM products p
        JOIN vendors v ON v.id = p.vendor_id
        WHERE p.status = 'ACTIVE' AND v.status = 'ACTIVE'
          AND (${f.vendorSlug}::text IS NULL OR v.slug = ${f.vendorSlug}::text)
          AND (${categoryIds}::text[] IS NULL OR EXISTS (
            SELECT 1 FROM product_categories pc
            WHERE pc.product_id = p.id AND pc.category_id = ANY(${categoryIds}::text[])))
          AND (${f.currency}::text IS NULL OR p.base_price_currency::text = ${f.currency}::text)
          AND (${f.minPrice}::bigint IS NULL OR p.base_price_amount >= ${f.minPrice}::bigint)
          AND (${f.maxPrice}::bigint IS NULL OR p.base_price_amount <= ${f.maxPrice}::bigint)
      )
      SELECT b.id FROM base b
      WHERE ${f.cursor}::text IS NULL
        OR b.sort_key > (SELECT c.sort_key FROM base c WHERE c.id = ${f.cursor}::text)
        OR (b.sort_key = (SELECT c.sort_key FROM base c WHERE c.id = ${f.cursor}::text)
            AND b.id < ${f.cursor}::text)
      ORDER BY b.sort_key ASC, b.id DESC
      LIMIT ${f.take}::int`;
    return rows.map((row) => row.id);
  }

  /**
   * Visible product ids matching `q`, best first (rank DESC, id DESC), keyset-paginated like
   * `listVisibleIds`. A product matches when, in ANY of its translations, (a) the generated
   * `search_vector` matches `websearch_to_tsquery('simple', q)` (accent-sensitive), (b) `q` is
   * word-similar to the name (pg_trgm `<%`, typo tolerant), or (c) the accent-folded query is a
   * substring of the (already ASCII) slug — this is what makes unaccented Vietnamese work, since
   * the DB has no `unaccent` extension.
   */
  async searchVisibleIds(q: string, cursor: string | null, take: number): Promise<string[]> {
    const folded = escapeLike(foldForSlugMatch(q));
    const slugPattern = `%${folded}%`;
    const rows = await this.prisma.client.$queryRaw<IdRow[]>`
      WITH matches AS (
        SELECT p.id,
          MAX(ROUND((
            ts_rank(pt.search_vector, websearch_to_tsquery('simple', ${q}::text))
            + word_similarity(${q}::text, pt.name)
            + CASE WHEN ${folded}::text <> '' AND replace(pt.slug, '-', ' ') LIKE ${slugPattern}::text ESCAPE '\\'
                   THEN 0.5 ELSE 0 END
          )::numeric, 4)) AS rank
        FROM product_translations pt
        JOIN products p ON p.id = pt.product_id
        JOIN vendors v ON v.id = p.vendor_id
        WHERE p.status = 'ACTIVE' AND v.status = 'ACTIVE'
          AND (
            pt.search_vector @@ websearch_to_tsquery('simple', ${q}::text)
            OR ${q}::text <% pt.name
            OR (${folded}::text <> '' AND replace(pt.slug, '-', ' ') LIKE ${slugPattern}::text ESCAPE '\\')
          )
        GROUP BY p.id
      )
      SELECT m.id FROM matches m
      WHERE ${cursor}::text IS NULL
        OR m.rank < (SELECT c.rank FROM matches c WHERE c.id = ${cursor}::text)
        OR (m.rank = (SELECT c.rank FROM matches c WHERE c.id = ${cursor}::text)
            AND m.id < ${cursor}::text)
      ORDER BY m.rank DESC, m.id DESC
      LIMIT ${take}::int`;
    return rows.map((row) => row.id);
  }
}
