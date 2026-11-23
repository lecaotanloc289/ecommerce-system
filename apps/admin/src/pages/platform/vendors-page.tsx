import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VendorStatusSchema } from '@repo/core';
import { formatDate } from '@repo/i18n';
import { Button } from '@repo/ui';
import { api } from '@/auth/session';
import { ConfirmReasonDialog } from '@/components/confirm-reason-dialog';
import { CursorTable, type Column } from '@/components/cursor-table';
import { ErrorAlert } from '@/components/error-alert';
import { FilterBar, FilterSelect, SearchForm } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { compact } from '@/lib/compact';
import { unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';

type Vendor = {
  id: string;
  slug: string;
  displayName: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  suspendedReason: string | null;
  ownerName: string;
  ownerEmail: string | null;
  createdAt: string;
};

const VENDORS_KEY = ['platform', 'vendors'] as const;
const STATUS_KEYS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

export function VendorsPage() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Vendor | null>(null);
  const parsedStatus = VendorStatusSchema.safeParse(status).data;

  const list = useCursorList<Vendor>([...VENDORS_KEY, 'list', parsedStatus, q], (cursor) =>
    unwrap(
      api.GET('/v1/platform/vendors', {
        params: { query: compact({ status: parsedStatus, q: q || undefined, cursor, limit: 20 }) },
      }),
    ),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: VENDORS_KEY });

  const suspend = useApiMutation(
    (v: { id: string; reason: string }, headers) =>
      unwrap(
        api.POST('/v1/platform/vendors/{id}/suspend', {
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
  const reactivate = useApiMutation(
    (id: string, headers) =>
      unwrap(
        api.POST('/v1/platform/vendors/{id}/reactivate', {
          params: { path: { id }, header: headers },
        }),
      ),
    { onSuccess: refresh },
  );

  const columns: Column<Vendor>[] = [
    {
      header: t('admin.platform.vendors.shop'),
      cell: (v) => (
        <div className="flex flex-col">
          <span className="font-medium">{v.displayName}</span>
          <span className="text-body-s text-text-muted">{v.slug}</span>
        </div>
      ),
    },
    {
      header: t('admin.platform.vendors.owner'),
      cell: (v) => `${v.ownerName}${v.ownerEmail ? ` · ${v.ownerEmail}` : ''}`,
    },
    {
      header: t('admin.platform.common.statusFilter'),
      cell: (v) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={v.status} />
          {v.suspendedReason ? (
            <span className="text-body-s text-text-muted">{v.suspendedReason}</span>
          ) : null}
        </div>
      ),
    },
    { header: t('admin.platform.common.created'), cell: (v) => formatDate(v.createdAt, locale) },
    {
      header: t('admin.platform.common.details'),
      cell: (v) =>
        v.status === 'ACTIVE' ? (
          <Button size="sm" variant="destructive" onClick={() => setTarget(v)}>
            {t('admin.platform.vendors.suspend')}
          </Button>
        ) : v.status === 'SUSPENDED' ? (
          <Button
            size="sm"
            variant="secondary"
            loading={reactivate.isPending && reactivate.variables === v.id}
            onClick={() => reactivate.mutate(v.id)}
          >
            {t('admin.platform.vendors.reactivate')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.vendors')} />
      <FilterBar>
        <FilterSelect
          label={t('admin.platform.common.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('admin.platform.common.allStatuses')}</option>
          {VendorStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`admin.platform.status.${STATUS_KEYS[value]}`)}
            </option>
          ))}
        </FilterSelect>
        <SearchForm
          value={q}
          onSearch={setQ}
          placeholder={t('admin.platform.vendors.searchPlaceholder')}
        />
      </FilterBar>
      {reactivate.isError ? <ErrorAlert error={reactivate.error} className="mb-3" /> : null}
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(v) => v.id}
        caption={t('admin.nav.vendors')}
      />
      <ConfirmReasonDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            suspend.reset();
            suspend.resetAction();
          }
        }}
        title={t('admin.platform.vendors.suspendTitle')}
        description={`${target?.displayName ?? ''} — ${t('admin.platform.vendors.suspendDescription')}`}
        confirmLabel={t('admin.platform.vendors.suspend')}
        reasonLabel={t('admin.platform.vendors.suspendedReason')}
        destructive
        pending={suspend.isPending}
        error={suspend.error}
        onConfirm={(reason) => target && suspend.mutate({ id: target.id, reason })}
      />
    </>
  );
}
