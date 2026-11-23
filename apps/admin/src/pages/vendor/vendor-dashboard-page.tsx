import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { VendorSubOrderPageSchema, type VendorSubOrderStatus } from '@repo/core';
import { formatMoney } from '@repo/i18n';
import { api, useCurrentUser } from '@/auth/session';
import { hasAnyRole, VENDOR_OWNER_ROLES } from '@/auth/roles';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { useVendorWallet } from './wallet-page';

const COUNT_LIMIT = 100;

/** Number of sub-orders in `status`, capped at `COUNT_LIMIT` (`nextCursor` set → "100+"). */
function useOrderCount(status: VendorSubOrderStatus) {
  return useQuery({
    queryKey: ['vendor', 'orders', 'count', status],
    queryFn: () =>
      unwrap(
        api.GET('/v1/vendor/sub-orders', { params: { query: { status, limit: COUNT_LIMIT } } }),
      ).then((data) => VendorSubOrderPageSchema.parse(data)),
  });
}

/** `/vendor` — work queue counts (PAID to accept, PROCESSING to ship) and, for owners, the wallet. */
export function VendorDashboardPage() {
  const { t, locale } = useLocale();
  const user = useCurrentUser();
  const isOwner = hasAnyRole(user.roles, VENDOR_OWNER_ROLES);
  const paid = useOrderCount('PAID');
  const processing = useOrderCount('PROCESSING');
  const wallet = useVendorWallet(isOwner);

  const count = (page: typeof paid.data) =>
    page ? (page.nextCursor ? `${COUNT_LIMIT}+` : String(page.items.length)) : '…';
  const error = paid.error ?? processing.error ?? wallet.error;

  return (
    <>
      <PageHeader
        title={t('admin.portal.vendor')}
        description={t('admin.dashboard.welcome', { name: user.name })}
      />
      {error ? <ErrorAlert className="mb-4" error={error} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          to="/vendor/orders?status=PAID"
          label={t('admin.vendor.dashboard.toAccept')}
          value={count(paid.data)}
        />
        <Tile
          to="/vendor/orders?status=PROCESSING"
          label={t('admin.vendor.dashboard.toShip')}
          value={count(processing.data)}
        />
        {isOwner ? (
          <Tile
            to="/vendor/wallet"
            label={t('admin.vendor.dashboard.walletBalance')}
            value={wallet.data ? formatMoney(wallet.data.balance, locale) : '…'}
          >
            {wallet.data?.pending.map((money) => (
              <p key={money.currency} className="text-caption text-text-muted">
                {t('admin.vendor.dashboard.pendingAmount', { amount: formatMoney(money, locale) })}
              </p>
            ))}
          </Tile>
        ) : null}
      </div>
    </>
  );
}

function Tile({
  to,
  label,
  value,
  children,
}: {
  to: string;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-bg-elevated p-4 hover:border-border-strong"
    >
      <span className="text-body-s text-text-muted">{label}</span>
      <span className="font-heading text-h5 font-bold text-text-primary">{value}</span>
      {children}
    </Link>
  );
}
