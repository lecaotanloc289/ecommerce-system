import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { LedgerEntryPageSchema, VendorWalletSchema, type LedgerEntry } from '@repo/core';
import { formatDateTime, formatMoney } from '@repo/i18n';
import { api } from '@/auth/session';
import { DataTable, type Column } from '@/components/data-table';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { useCursorList } from '@/lib/use-cursor-list';

export const WALLET_QUERY_KEY = ['vendor', 'wallet'];

/** Owner-only wallet summary (released balance + pending per currency); shared with the dashboard. */
export function useVendorWallet(enabled = true) {
  return useQuery({
    enabled,
    queryKey: WALLET_QUERY_KEY,
    queryFn: () =>
      unwrap(api.GET('/v1/vendor/wallet')).then((data) => VendorWalletSchema.parse(data)),
  });
}

/** `/vendor/wallet` (owner only) — balance, pending payouts per currency, ledger history. */
export function WalletPage() {
  const { t, locale } = useLocale();
  const wallet = useVendorWallet();
  const ledger = useCursorList<LedgerEntry>(['vendor', 'ledger'], (cursor) =>
    unwrap(
      api.GET('/v1/vendor/ledger', {
        params: { query: { limit: 20, ...(cursor ? { cursor } : {}) } },
      }),
    ).then((data) => LedgerEntryPageSchema.parse(data)),
  );

  const columns: Column<LedgerEntry>[] = [
    {
      key: 'date',
      header: t('admin.vendor.wallet.date'),
      cell: (row) => formatDateTime(row.createdAt, locale),
    },
    {
      key: 'type',
      header: t('admin.vendor.wallet.type'),
      cell: (row) => t(`admin.vendor.ledgerType.${row.entryType}`),
    },
    {
      key: 'order',
      header: t('admin.vendor.wallet.order'),
      cell: (row) =>
        row.subOrderId ? (
          <Link to={`/vendor/orders/${row.subOrderId}`} className="text-text-link hover:underline">
            #{row.subOrderId.slice(-8)}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'amount',
      header: t('admin.vendor.wallet.amount'),
      className: 'text-right',
      cell: (row) => (
        <span className={row.amount.amount < 0 ? 'text-danger-fg' : 'text-success-fg'}>
          {formatMoney(row.amount, locale)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.wallet')} />
      {wallet.error ? <ErrorAlert className="mb-4" error={wallet.error} /> : null}
      {wallet.data ? (
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <p className="text-body-s text-text-muted">{t('admin.vendor.wallet.balance')}</p>
            <p className="font-heading text-h5 font-bold text-text-primary">
              {formatMoney(wallet.data.balance, locale)}
            </p>
          </div>
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <p className="text-body-s text-text-muted">{t('admin.vendor.wallet.pending')}</p>
            {wallet.data.pending.length === 0 ? (
              <p className="text-body-m text-text-muted">{t('admin.vendor.wallet.noPending')}</p>
            ) : (
              <ul>
                {wallet.data.pending.map((money) => (
                  <li key={money.currency} className="font-heading text-h6 font-semibold">
                    {formatMoney(money, locale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
      <h2 className="mb-3 font-heading text-body-l font-semibold text-text-primary">
        {t('admin.vendor.wallet.ledger')}
      </h2>
      <DataTable
        columns={columns}
        rows={ledger.items}
        getKey={(row) => row.id}
        isLoading={ledger.isPending}
        error={ledger.error}
        emptyText={t('admin.vendor.wallet.empty')}
        hasNextPage={ledger.hasNextPage}
        isFetchingNextPage={ledger.isFetchingNextPage}
        onLoadMore={() => void ledger.fetchNextPage()}
      />
    </>
  );
}
