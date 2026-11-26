import { useState } from 'react';
import { Link } from 'react-router';
import { RefundStatusSchema, type Money } from '@repo/core';
import { formatDate } from '@repo/i18n';
import { api } from '@/auth/session';
import { CursorTable, type Column } from '@/components/cursor-table';
import { FilterBar, FilterSelect } from '@/components/filter-bar';
import { MoneyText } from '@/components/money-text';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { compact } from '@/lib/compact';
import { unwrap } from '@/lib/api-error';
import { useCursorList } from '@/lib/use-cursor-list';
import { RetryRefundAction } from './retry-refund';

type RefundRow = {
  id: string;
  orderId: string;
  amount: Money;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  reason: string;
  createdAt: string;
};

const STATUS_KEYS = { PENDING: 'pending', SUCCEEDED: 'succeeded', FAILED: 'failed' } as const;

/** `/platform/refunds` — all refunds, status filter; ADMIN can retry a FAILED one. */
export function RefundsPage() {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState('');
  const parsedStatus = RefundStatusSchema.safeParse(status).data;

  const list = useCursorList<RefundRow>(['platform', 'refunds', 'list', parsedStatus], (cursor) =>
    unwrap(
      api.GET('/v1/platform/refunds', {
        params: { query: compact({ status: parsedStatus, cursor, limit: 20 }) },
      }),
    ),
  );

  const columns: Column<RefundRow>[] = [
    {
      header: t('admin.platform.common.order'),
      cell: (r) => (
        <Link
          className="font-mono text-body-s text-brand-text underline"
          to={`/platform/orders?id=${encodeURIComponent(r.orderId)}`}
        >
          {r.orderId}
        </Link>
      ),
    },
    { header: t('admin.platform.refunds.amount'), cell: (r) => <MoneyText money={r.amount} /> },
    { header: t('admin.platform.refunds.reason'), cell: (r) => r.reason },
    {
      header: t('admin.platform.common.statusFilter'),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    { header: t('admin.platform.common.created'), cell: (r) => formatDate(r.createdAt, locale) },
    { header: t('admin.platform.refunds.actions'), cell: (r) => <RetryRefundAction refund={r} /> },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.refunds')} />
      <FilterBar>
        <FilterSelect
          label={t('admin.platform.common.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('admin.platform.common.allStatuses')}</option>
          {RefundStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`admin.platform.status.${STATUS_KEYS[value]}`)}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption={t('admin.nav.refunds')}
      />
    </>
  );
}
