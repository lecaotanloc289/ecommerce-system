import { Link, useSearchParams } from 'react-router';
import {
  VendorSubOrderPageSchema,
  VendorSubOrderStatusSchema,
  type VendorSubOrder,
} from '@repo/core';
import { formatDate, formatMoney } from '@repo/i18n';
import { inputVariants } from '@repo/ui';
import { api } from '@/auth/session';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { useCursorList } from '@/lib/use-cursor-list';
import { OrderActions } from './order-actions';
import { OrderStatusBadge } from './vendor-status';

/** `/vendor/orders?status=` — own paid sub-orders, newest first, with the next action per row. */
export function OrdersPage() {
  const { t, locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const parsedStatus = VendorSubOrderStatusSchema.safeParse(params.get('status'));
  const status = parsedStatus.success ? parsedStatus.data : undefined;

  const list = useCursorList<VendorSubOrder>(['vendor', 'orders', 'list', status ?? ''], (cursor) =>
    unwrap(
      api.GET('/v1/vendor/sub-orders', {
        params: {
          query: { limit: 20, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) },
        },
      }),
    ).then((data) => VendorSubOrderPageSchema.parse(data)),
  );

  const columns: Column<VendorSubOrder>[] = [
    {
      key: 'id',
      header: t('admin.vendor.orders.order'),
      cell: (row) => (
        <Link
          to={`/vendor/orders/${row.id}`}
          className="font-semibold text-text-link hover:underline"
        >
          #{row.id.slice(-8)}
        </Link>
      ),
    },
    {
      key: 'created',
      header: t('admin.vendor.orders.created'),
      cell: (row) => formatDate(row.createdAt, locale),
    },
    {
      key: 'recipient',
      header: t('admin.vendor.orders.recipient'),
      cell: (row) => row.shippingAddress.recipientName,
    },
    {
      key: 'status',
      header: t('admin.vendor.orders.status'),
      cell: (row) => <OrderStatusBadge status={row.status} />,
    },
    {
      key: 'total',
      header: t('admin.vendor.orders.total'),
      cell: (row) => formatMoney(row.total, locale),
    },
    {
      key: 'net',
      header: t('admin.vendor.orders.net'),
      cell: (row) => formatMoney(row.net, locale),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('admin.vendor.orders.actions')}</span>,
      cell: (row) => <OrderActions orderId={row.id} status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.orders')} />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="order-status" className="text-body-s text-text-muted">
          {t('admin.vendor.orders.status')}
        </label>
        <select
          id="order-status"
          className={inputVariants({ className: 'w-48' })}
          value={status ?? ''}
          onChange={(event) => {
            const next = VendorSubOrderStatusSchema.safeParse(event.target.value);
            setParams(next.success ? { status: next.data } : {});
          }}
        >
          <option value="">{t('admin.vendor.filter.all')}</option>
          {VendorSubOrderStatusSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`admin.vendor.orderStatus.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={list.items}
        getKey={(row) => row.id}
        isLoading={list.isPending}
        error={list.error}
        emptyText={t('admin.vendor.orders.empty')}
        hasNextPage={list.hasNextPage}
        isFetchingNextPage={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
      />
    </>
  );
}
