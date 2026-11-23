import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import {
  ProductStatusSchema,
  VendorProductPageSchema,
  type ProductStatus,
  type VendorProductSummary,
} from '@repo/core';
import { formatDate, formatMoney } from '@repo/i18n';
import { buttonVariants, inputVariants } from '@repo/ui';
import { api } from '@/auth/session';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { useCursorList } from '@/lib/use-cursor-list';
import { ProductStatusBadge } from './vendor-status';

/** `/vendor/products` — own products, newest first, optional status filter. */
export function ProductsPage() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<ProductStatus | ''>('');

  const list = useCursorList<VendorProductSummary>(['vendor', 'products', status], (cursor) =>
    unwrap(
      api.GET('/v1/vendor/products', {
        params: {
          query: { limit: 20, ...(cursor ? { cursor } : {}), ...(status ? { status } : {}) },
        },
      }),
    ).then((data) => VendorProductPageSchema.parse(data)),
  );

  const columns: Column<VendorProductSummary>[] = [
    {
      key: 'name',
      header: t('admin.vendor.products.name'),
      cell: (row) => (
        <div className="flex items-center gap-3">
          {row.primaryImageUrl ? (
            <img src={row.primaryImageUrl} alt="" className="size-10 rounded-sm object-cover" />
          ) : (
            <div className="size-10 rounded-sm bg-bg-muted" aria-hidden />
          )}
          <Link
            to={`/vendor/products/${row.id}`}
            className="font-semibold text-text-link hover:underline"
          >
            {row.name}
          </Link>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('admin.vendor.products.status'),
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <ProductStatusBadge status={row.status} />
          {row.status === 'BLOCKED' && row.blockedReason ? (
            <span className="text-caption text-danger-fg">{row.blockedReason}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'price',
      header: t('admin.vendor.products.price'),
      cell: (row) => formatMoney(row.basePrice, locale),
    },
    {
      key: 'stock',
      header: t('admin.vendor.products.stock'),
      cell: (row) =>
        t('admin.vendor.products.stockSummary', {
          stock: row.stockOnHand,
          variants: row.variantCount,
        }),
    },
    {
      key: 'updated',
      header: t('admin.vendor.products.updated'),
      cell: (row) => formatDate(row.updatedAt, locale),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('admin.nav.products')}
        actions={
          <Link to="/vendor/products/new" className={buttonVariants()}>
            <Plus aria-hidden />
            {t('admin.vendor.products.new')}
          </Link>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="product-status" className="text-body-s text-text-muted">
          {t('admin.vendor.products.status')}
        </label>
        <select
          id="product-status"
          className={inputVariants({ className: 'w-48' })}
          value={status}
          onChange={(event) => {
            const parsed = ProductStatusSchema.safeParse(event.target.value);
            setStatus(parsed.success ? parsed.data : '');
          }}
        >
          <option value="">{t('admin.vendor.filter.all')}</option>
          {ProductStatusSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`admin.vendor.productStatus.${option}`)}
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
        emptyText={t('admin.vendor.products.empty')}
        hasNextPage={list.hasNextPage}
        isFetchingNextPage={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
      />
    </>
  );
}
