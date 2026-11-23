import type { ReactNode } from 'react';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui';
import { ErrorAlert } from '@/components/error-alert';
import { useT } from '@/i18n/use-locale';
import type { CursorList } from '@/lib/use-cursor-list';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Table over a `useCursorList` result: loading / error / empty states and a "Load more" button. */
export function CursorTable<T>({
  list,
  columns,
  rowKey,
  caption,
}: {
  list: CursorList<T>;
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible name of the table. */
  caption: string;
}) {
  const t = useT();
  if (list.isError && list.items.length === 0) return <ErrorAlert error={list.error} />;
  if (list.isPending) {
    return (
      <p role="status" className="py-8 text-center text-body-s text-text-muted">
        {t('admin.platform.common.loading')}
      </p>
    );
  }
  if (list.items.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated px-6 py-12 text-center text-body-s text-text-muted">
        {t('admin.platform.common.empty')}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border-subtle bg-bg-elevated">
        <Table aria-label={caption}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.header} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.header} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {list.isError ? <ErrorAlert error={list.error} /> : null}
      {list.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('admin.platform.common.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
