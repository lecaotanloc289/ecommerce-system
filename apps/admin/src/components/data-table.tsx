import type { ReactNode } from 'react';
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui';
import { useT } from '@/i18n/use-locale';
import { ErrorAlert } from './error-alert';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
}

/** Table for a cursor-paginated list: loading / error / empty states and a "Load more" footer. */
export function DataTable<Row>({
  columns,
  rows,
  getKey,
  isLoading,
  error,
  emptyText,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  getKey: (row: Row) => string;
  isLoading: boolean;
  error: unknown;
  emptyText: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const t = useT();
  if (error) return <ErrorAlert error={error} />;
  if (isLoading) {
    return (
      <p role="status" className="py-8 text-center text-body-s text-text-muted">
        {t('admin.table.loading')}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-default bg-bg-elevated px-6 py-12 text-center text-body-s text-text-muted">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border-subtle bg-bg-elevated">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getKey(row)}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasNextPage ? (
        <Button
          variant="secondary"
          className="self-center"
          loading={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {t('admin.table.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
