import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatDate } from '@repo/i18n';
import { api, useCurrentUser } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { MoneyText } from '@/components/money-text';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';

const COUNT_LIMIT = 100;

function CountCard({
  label,
  count,
  more,
  to,
  isError,
}: {
  label: string;
  count: number | null;
  more: boolean;
  to: string;
  isError: boolean;
}) {
  const { t } = useLocale();
  return (
    <Link
      to={to}
      className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-bg-elevated p-5 hover:border-border-strong"
    >
      <span className="text-body-s text-text-muted">{label}</span>
      <span className="font-heading text-h4 font-bold text-text-primary">
        {isError || count === null
          ? t('admin.platform.common.none')
          : more
            ? t('admin.platform.dashboard.countAtLeast', { count })
            : count}
      </span>
    </Link>
  );
}

/** Platform dashboard: work waiting for staff + the latest orders. Counts cap at 100 ("100+"). */
export function PlatformDashboardPage() {
  const { t, locale } = useLocale();
  const user = useCurrentUser();

  const applications = useQuery({
    queryKey: ['platform', 'applications', 'pending-count'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/vendor-applications', {
          params: { query: { status: 'PENDING', limit: COUNT_LIMIT } },
        }),
      ),
  });
  const refunds = useQuery({
    queryKey: ['platform', 'refunds', 'pending-count'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/platform/refunds', {
          params: { query: { status: 'PENDING', limit: COUNT_LIMIT } },
        }),
      ),
  });
  const orders = useQuery({
    queryKey: ['platform', 'orders', 'recent'],
    queryFn: () => unwrap(api.GET('/v1/platform/orders', { params: { query: { limit: 5 } } })),
  });

  return (
    <>
      <PageHeader
        title={t('admin.portal.platform')}
        description={t('admin.dashboard.welcome', { name: user.name })}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <CountCard
          label={t('admin.platform.dashboard.pendingApplications')}
          count={applications.data?.items.length ?? null}
          more={Boolean(applications.data?.nextCursor)}
          to="/platform/applications"
          isError={applications.isError}
        />
        <CountCard
          label={t('admin.platform.dashboard.pendingRefunds')}
          count={refunds.data?.items.length ?? null}
          more={Boolean(refunds.data?.nextCursor)}
          to="/platform/refunds"
          isError={refunds.isError}
        />
      </div>
      {applications.isError ? <ErrorAlert error={applications.error} className="mb-3" /> : null}
      {refunds.isError ? <ErrorAlert error={refunds.error} className="mb-3" /> : null}

      <section
        aria-labelledby="recent-orders"
        className="rounded-lg border border-border-subtle bg-bg-elevated p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-orders" className="text-body-l font-semibold">
            {t('admin.platform.dashboard.recentOrders')}
          </h2>
          <Link className="text-body-s text-brand-text underline" to="/platform/orders">
            {t('admin.platform.dashboard.viewAll')}
          </Link>
        </div>
        {orders.isError ? <ErrorAlert error={orders.error} /> : null}
        {orders.data && orders.data.items.length === 0 ? (
          <p className="text-body-s text-text-muted">{t('admin.platform.common.empty')}</p>
        ) : null}
        <ul className="divide-y divide-border-subtle">
          {orders.data?.items.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-3 py-2">
              <Link
                className="font-mono text-body-s text-brand-text underline"
                to={`/platform/orders?id=${encodeURIComponent(order.id)}`}
              >
                {order.id}
              </Link>
              <span className="flex-1">{order.customerName}</span>
              <MoneyText money={order.grandTotal} />
              <StatusBadge status={order.status} />
              <span className="text-body-s text-text-muted">
                {formatDate(order.createdAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
