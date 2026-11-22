import type { PageQuery } from '@repo/core';

export type PageDirection = 'desc' | 'asc';

/** Prisma `findMany` arguments for one cursor page over a ULID `id` column. */
export interface CursorPageArgs {
  take: number;
  where: { id?: { lt: string } | { gt: string } };
  orderBy: { id: PageDirection };
}

/**
 * Cursor pagination over ULID primary keys (ULIDs sort by creation time). `desc` = newest first:
 * the next page is `id < cursor`. Fetches `limit + 1` rows so `toPage` can tell whether another
 * page exists without a COUNT. Spread `where` into your own filter:
 *
 * ```ts
 * const args = cursorPageArgs(query);
 * const rows = await db.order.findMany({ ...args, where: { userId, ...args.where } });
 * return toPage(rows, query);
 * ```
 */
export function cursorPageArgs(
  query: PageQuery,
  direction: PageDirection = 'desc',
): CursorPageArgs {
  const where =
    query.cursor === undefined
      ? {}
      : { id: direction === 'desc' ? { lt: query.cursor } : { gt: query.cursor } };
  return { take: query.limit + 1, where, orderBy: { id: direction } };
}

/**
 * Trims the look-ahead row and derives `nextCursor` (null on the last page). Map `items` to the
 * response schema afterwards; the shape matches `PageSchema(item)` from `@repo/core`.
 */
export function toPage<Row extends { id: string }>(
  rows: readonly Row[],
  query: PageQuery,
): { items: Row[]; nextCursor: string | null } {
  const items = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
