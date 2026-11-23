import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

export interface CursorPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated list (`?cursor=<last id>`): `fetchPage(cursor)` returns one page; `items` is
 * every page loaded so far, newest first, and `fetchNextPage` appends the next one.
 */
export function useCursorList<Item>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<Item>>,
) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...query, items };
}
