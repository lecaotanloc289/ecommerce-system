import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProductStatusSchema, VendorIdSchema, type Money } from '@repo/core';
import { Button } from '@repo/ui';
import { api } from '@/auth/session';
import { ConfirmReasonDialog } from '@/components/confirm-reason-dialog';
import { CursorTable, type Column } from '@/components/cursor-table';
import { ErrorAlert } from '@/components/error-alert';
import { FilterBar, FilterSelect, SearchForm } from '@/components/filter-bar';
import { MoneyText } from '@/components/money-text';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { compact } from '@/lib/compact';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';

type Product = {
  id: string;
  vendorName: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'BLOCKED';
  blockedReason: string | null;
  name: string;
  basePrice: Money;
};

const PRODUCTS_KEY = ['platform', 'products'] as const;
const STATUS_KEYS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  BLOCKED: 'blocked',
} as const;

export function ProductsPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [vendor, setVendor] = useState('');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Product | null>(null);
  const parsedStatus = ProductStatusSchema.safeParse(status).data;
  const parsedVendor = VendorIdSchema.safeParse(vendor).data;

  // Shop filter options: the first page of shops is enough for a filter box.
  const vendors = useQuery({
    queryKey: ['platform', 'vendors', 'options'],
    queryFn: () => unwrap(api.GET('/v1/platform/vendors', { params: { query: { limit: 100 } } })),
    staleTime: 60_000,
  });

  const list = useCursorList<Product>(
    [...PRODUCTS_KEY, 'list', parsedStatus, parsedVendor, q],
    (cursor) =>
      unwrap(
        api.GET('/v1/platform/products', {
          params: {
            query: compact({
              status: parsedStatus,
              vendorId: parsedVendor,
              q: q || undefined,
              cursor,
              limit: 20,
            }),
          },
        }),
      ),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
  const block = useApiMutation(
    (v: { id: string; reason: string }, headers) =>
      unwrap(
        api.POST('/v1/platform/products/{id}/block', {
          params: { path: { id: v.id }, header: headers },
          body: { reason: v.reason },
        }),
      ),
    {
      onSuccess: async () => {
        await refresh();
        setTarget(null);
      },
    },
  );
  const unblock = useApiMutation(
    (id: string, headers) =>
      unwrap(
        api.POST('/v1/platform/products/{id}/unblock', {
          params: { path: { id }, header: headers },
        }),
      ),
    { onSuccess: refresh },
  );

  const columns: Column<Product>[] = [
    {
      header: t('admin.platform.products.product'),
      cell: (p) => (
        <div className="flex flex-col">
          <span className="font-medium">{p.name}</span>
          <span className="text-body-s text-text-muted">{p.id}</span>
        </div>
      ),
    },
    { header: t('admin.platform.common.vendor'), cell: (p) => p.vendorName },
    { header: t('admin.platform.products.price'), cell: (p) => <MoneyText money={p.basePrice} /> },
    {
      header: t('admin.platform.common.statusFilter'),
      cell: (p) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={p.status} />
          {p.blockedReason ? (
            <span className="text-body-s text-text-muted">{p.blockedReason}</span>
          ) : null}
        </div>
      ),
    },
    {
      header: t('admin.platform.common.details'),
      cell: (p) =>
        p.status === 'BLOCKED' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={unblock.isPending && unblock.variables === p.id}
            onClick={() => unblock.mutate(p.id)}
          >
            {t('admin.platform.products.unblock')}
          </Button>
        ) : (
          <Button size="sm" variant="destructive" onClick={() => setTarget(p)}>
            {t('admin.platform.products.block')}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.products')} />
      <FilterBar>
        <FilterSelect
          label={t('admin.platform.common.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('admin.platform.common.allStatuses')}</option>
          {ProductStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`admin.platform.status.${STATUS_KEYS[value]}`)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label={t('admin.platform.common.vendor')}
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        >
          <option value="">{t('admin.platform.products.allVendors')}</option>
          {vendors.data?.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.displayName}
            </option>
          ))}
        </FilterSelect>
        <SearchForm
          value={q}
          onSearch={setQ}
          placeholder={t('admin.platform.products.searchPlaceholder')}
        />
      </FilterBar>
      {unblock.isError ? <ErrorAlert error={unblock.error} className="mb-3" /> : null}
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(p) => p.id}
        caption={t('admin.nav.products')}
      />
      <ConfirmReasonDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            block.reset();
            block.resetAction();
          }
        }}
        title={t('admin.platform.products.blockTitle')}
        description={`${target?.name ?? ''} — ${t('admin.platform.products.blockDescription')}`}
        confirmLabel={t('admin.platform.products.block')}
        reasonLabel={t('admin.platform.products.blockedReason')}
        destructive
        pending={block.isPending}
        error={block.error}
        onConfirm={(reason) => target && block.mutate({ id: target.id, reason })}
      />
    </>
  );
}
