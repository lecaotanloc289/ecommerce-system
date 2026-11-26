import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type CursorList<T> = UseInfiniteQueryResult<{ pages: CursorPage<T>[] }, Error> & {
  items: T[];
};

/**
 * Cursor-paginated list (`{ items, nextCursor }` pages, "load more"). `queryKey` must contain
 * every filter so a filter change starts a fresh list.
 */
export function useCursorList<T>(
  queryKey: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
): CursorList<T> {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return Object.assign(query, { items });
}
