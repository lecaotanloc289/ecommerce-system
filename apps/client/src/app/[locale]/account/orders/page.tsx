'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { Button, Card } from '@repo/ui';
import type { OrderSummary } from '@repo/core';
import { formatDate, formatMoney } from '@repo/i18n';
import { Container } from '@/components/layout/container';
import { RequireAuth } from '@/components/auth/require-auth';
import { OrderStatusBadge, shortOrderId } from '@/components/order/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { fetchOrders } from '@/lib/api/commerce';
import { useAuth } from '@/store/auth-provider';

function OrdersList() {
  const { locale, t } = useLocale();
  const { user } = useAuth();
  const [orders, setOrders] = React.useState<OrderSummary[] | null>(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchOrders().then(
      (page) => {
        if (cancelled) return;
        setOrders(page.items);
        setNextCursor(page.nextCursor);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setFailed(false);
    try {
      const page = await fetchOrders(nextCursor);
      setOrders((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('orders.title')}
      </h1>

      <div className="mt-8 flex flex-col gap-4">
        {orders === null && !failed ? (
          <p role="status" className="text-body-m text-text-muted">
            {t('common.loading')}
          </p>
        ) : null}
        {orders?.length === 0 ? (
          <p className="text-body-m text-text-muted">{t('orders.empty')}</p>
        ) : null}
        {orders?.map((order) => (
          <Card key={order.id} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex flex-col gap-1">
              <Link
                href={`/account/orders/${order.id}`}
                className="text-body-l font-semibold text-text-primary hover:text-brand-text"
              >
                {t('orders.orderNumber', { id: shortOrderId(order.id) })}
              </Link>
              <p className="text-body-s text-text-muted">
                {t('orders.placedOn', { date: formatDate(order.createdAt, locale) })} ·{' '}
                {t('orders.itemCount', { count: order.itemCount })} ·{' '}
                {t('orders.shopCount', { count: order.subOrderCount })}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <OrderStatusBadge status={order.status} />
              <span className="text-body-l font-bold text-text-price">
                {formatMoney(order.grandTotal, locale)}
              </span>
              <Link
                href={`/account/orders/${order.id}`}
                className="text-body-m font-medium text-brand-text hover:underline"
              >
                {t('orders.viewDetails')}
              </Link>
            </div>
          </Card>
        ))}
        {failed ? (
          <p role="alert" className="text-body-m text-danger-fg">
            {t('orders.loadFailed')}
          </p>
        ) : null}
        {nextCursor ? (
          <div>
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
              {t('orders.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </Container>
  );
}

export default function AccountOrdersPage() {
  return (
    <RequireAuth title="orders.signInTitle" body="orders.signInBody">
      <OrdersList />
    </RequireAuth>
  );
}
