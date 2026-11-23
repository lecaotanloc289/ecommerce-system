'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@repo/ui';
import type { Order, SubOrder } from '@repo/core';
import { formatDateTime, formatMoney } from '@repo/i18n';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { RequireAuth } from '@/components/auth/require-auth';
import { AddressLines } from '@/components/address/address-lines';
import { OrderSummary } from '@/components/checkout/order-summary';
import { usePaymentFlow } from '@/components/checkout/use-payment-flow';
import { OrderTimeline } from '@/components/order/order-timeline';
import {
  OrderStatusBadge,
  SubOrderStatusBadge,
  shortOrderId,
} from '@/components/order/status-badge';
import { ProductImage } from '@/components/product/product-image';
import { Link } from '@/i18n/navigation';
import { useLocale } from '@/i18n/use-locale';
import { cancelOrder, confirmReceived, fetchOrder } from '@/lib/api/commerce';
import { describeError } from '@/lib/api/error-message';
import { attributesLabel } from '@/lib/cart';
import { canCancelOrder, canConfirmReceived, canPayOrder } from '@/lib/order-status';
import { useAuth } from '@/store/auth-provider';

function SubOrderCard({
  order,
  subOrder,
  onUpdated,
}: {
  order: Order;
  subOrder: SubOrder;
  onUpdated: (order: Order) => void;
}) {
  const { locale, t } = useLocale();
  const [busy, setBusy] = React.useState(false);

  const onConfirm = async () => {
    setBusy(true);
    try {
      onUpdated(await confirmReceived(order.id, subOrder.id));
      toast.success(t('orders.received'));
    } catch (e) {
      toast.error(t('orders.actionFailed'), { description: describeError(locale, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-h6 font-semibold text-text-primary">
          {t('orders.shopLabel', { vendor: subOrder.vendorName })}
        </h2>
        <SubOrderStatusBadge status={subOrder.status} />
      </div>

      <OrderTimeline subOrder={subOrder} />

      {subOrder.carrier || subOrder.trackingNumber ? (
        <p className="text-body-s text-text-muted">
          {subOrder.carrier ? `${t('orders.carrier')}: ${subOrder.carrier}` : ''}
          {subOrder.carrier && subOrder.trackingNumber ? ' · ' : ''}
          {subOrder.trackingNumber
            ? `${t('track.trackingNumber')}: ${subOrder.trackingNumber}`
            : ''}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-border-faint border-t border-border-faint">
        {subOrder.items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-3">
            <ProductImage
              src={null}
              alt={item.productTitle}
              className="size-14 shrink-0 rounded-md"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-body-m font-medium text-text-primary">
                {item.productTitle}
              </p>
              <p className="text-body-s text-text-muted">{attributesLabel(item.attributes)}</p>
            </div>
            <span className="text-body-s text-text-muted">×{item.quantity}</span>
            <span className="text-body-m font-semibold text-text-price">
              {formatMoney(item.lineTotal, locale)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 text-body-s text-text-muted">
        <span>
          {subOrder.shippingMethodName
            ? `${t('orders.shippingMethod')}: ${subOrder.shippingMethodName}`
            : ''}
        </span>
        <span className="text-body-m font-semibold text-text-primary">
          {formatMoney(subOrder.total, locale)}
        </span>
      </div>

      {canConfirmReceived(subOrder) ? (
        <div>
          <Button loading={busy} onClick={() => void onConfirm()}>
            {busy ? t('orders.confirming') : t('orders.confirmReceived')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function OrderDetail({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const { user } = useAuth();
  const [order, setOrder] = React.useState<Order | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const flow = usePaymentFlow();

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchOrder(orderId).then(
      (loaded) => {
        if (!cancelled) setOrder(loaded);
      },
      (e: unknown) => {
        if (!cancelled) setError(e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orderId, user?.id]);

  const onCancel = async () => {
    setCancelling(true);
    try {
      setOrder(await cancelOrder(orderId));
      setCancelOpen(false);
    } catch (e) {
      setCancelOpen(false);
      toast.error(t('orders.actionFailed'), { description: describeError(locale, e) });
    } finally {
      setCancelling(false);
    }
  };

  const itemCount = order
    ? order.subOrders.reduce((n, s) => n + s.items.reduce((m, i) => m + i.quantity, 0), 0)
    : 0;
  const firstAddress = order?.subOrders[0]?.shippingAddress;
  const payBusy = flow.state.phase === 'polling' || flow.state.phase === 'redirecting';

  return (
    <Container as="section" className="py-8 lg:py-12">
      <Link
        href="/account/orders"
        className="inline-flex items-center gap-1 text-body-m font-medium text-brand-text hover:underline"
      >
        <ArrowLeft className="size-4" />
        {t('orders.back')}
      </Link>

      {error ? (
        <Alert variant="danger" className="mt-6">
          <AlertDescription>{describeError(locale, error)}</AlertDescription>
        </Alert>
      ) : null}
      {!order && !error ? (
        <p role="status" className="mt-6 text-body-m text-text-muted">
          {t('common.loading')}
        </p>
      ) : null}

      {order ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
                {t('orders.orderNumber', { id: shortOrderId(order.id) })}
              </h1>
              <p className="mt-1 text-body-m text-text-muted">
                {t('orders.placedOn', { date: formatDateTime(order.createdAt, locale) })}
              </p>
            </div>
            <OrderStatusBadge status={order.status} />
          </div>

          {canPayOrder(order) ? (
            <Alert variant="warning" className="mt-6">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {order.paymentDeadlineAt
                    ? t('orders.payBefore', {
                        deadline: formatDateTime(order.paymentDeadlineAt, locale),
                      })
                    : t('orders.awaitingPaymentNote')}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button loading={payBusy} onClick={() => void flow.pay(order.id)}>
                    {payBusy ? t('checkout.waitingPayment') : t('orders.payNow')}
                  </Button>
                  {canCancelOrder(order) ? (
                    <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                      {t('orders.cancelOrder')}
                    </Button>
                  ) : null}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {flow.state.phase === 'timeout' || flow.state.phase === 'failed' ? (
            <Alert variant="danger" className="mt-4">
              <AlertDescription>
                {flow.state.phase === 'failed' && flow.state.error
                  ? describeError(locale, flow.state.error)
                  : flow.state.phase === 'timeout'
                    ? t('checkout.paymentTimeout')
                    : t('checkout.paymentFailed')}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
            <div className="flex flex-col gap-6">
              {order.subOrders.map((subOrder) => (
                <SubOrderCard
                  key={subOrder.id}
                  order={order}
                  subOrder={subOrder}
                  onUpdated={setOrder}
                />
              ))}
            </div>
            <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
              <OrderSummary
                totals={{
                  itemCount,
                  subtotal: order.itemsTotal,
                  shipping: order.shippingTotal,
                  discount: order.discountTotal,
                  total: order.grandTotal,
                }}
              />
              {firstAddress ? (
                <Card className="flex flex-col gap-3 p-5">
                  <h2 className="text-body-m font-semibold text-text-primary">
                    {t('orders.shippingAddress')}
                  </h2>
                  <AddressLines address={firstAddress} />
                </Card>
              ) : null}
              <ButtonLink href="/account/orders" variant="outline">
                {t('orders.back')}
              </ButtonLink>
            </div>
          </div>

          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('orders.cancelTitle')}</DialogTitle>
                <DialogDescription>{t('orders.cancelBody')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCancelOpen(false)}>
                  {t('orders.cancelKeep')}
                </Button>
                <Button variant="destructive" loading={cancelling} onClick={() => void onCancel()}>
                  {t('orders.cancelConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </Container>
  );
}

export default function AccountOrderDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequireAuth title="orders.signInTitle" body="orders.signInBody">
      <OrderDetail orderId={params.id} />
    </RequireAuth>
  );
}
