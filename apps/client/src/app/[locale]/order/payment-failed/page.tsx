'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { Alert, AlertDescription, Button, Card } from '@repo/ui';
import type { Order, PaymentProvider } from '@repo/core';
import { translateError } from '@repo/i18n';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { RequireAuth } from '@/components/auth/require-auth';
import { PaymentForm } from '@/components/checkout/payment-form';
import { usePaymentFlow } from '@/components/checkout/use-payment-flow';
import { useLocale } from '@/i18n/use-locale';
import { cancelOrder, fetchOrder } from '@/lib/api/commerce';
import { describeError } from '@/lib/api/errors';
import { resolveProvider } from '@/lib/checkout';
import { canCancelOrder, canPayOrder } from '@/lib/order-status';

function Shell({
  children,
  title,
  body,
}: {
  children?: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Container as="section" className="flex flex-col items-center py-16 text-center lg:py-24">
      <span className="flex size-24 items-center justify-center rounded-full bg-danger-bg">
        <XCircle className="size-12 text-danger-fg" aria-hidden />
      </span>
      <h1 className="mt-6 font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
        {title}
      </h1>
      <p className="mt-4 max-w-lg text-body-l text-text-muted">{body}</p>
      {children}
    </Container>
  );
}

function RetryPanel({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const [order, setOrder] = React.useState<Order | null>(null);
  const [loadError, setLoadError] = React.useState<unknown>(null);
  const [provider, setProvider] = React.useState<PaymentProvider | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<unknown>(null);
  const flow = usePaymentFlow();

  React.useEffect(() => {
    let alive = true;
    fetchOrder(orderId).then(
      (loaded) => {
        if (!alive) return;
        setOrder(loaded);
        setProvider(resolveProvider(null, loaded.grandTotal.currency));
      },
      (e: unknown) => {
        if (alive) setLoadError(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (loadError) {
    return (
      <Shell title={t('paymentFailed.title')} body={describeError(locale, loadError)}>
        <div className="mt-8">
          <ButtonLink href="/account/orders">{t('paymentFailed.myOrders')}</ButtonLink>
        </div>
      </Shell>
    );
  }
  if (!order) {
    return (
      <Container as="section" className="py-16 text-center text-body-m text-text-muted">
        <p role="status">{t('common.loading')}</p>
      </Container>
    );
  }

  const busy = flow.state.phase === 'polling' || flow.state.phase === 'redirecting';
  const payable = canPayOrder(order) && !cancelled;

  const onCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      setOrder(await cancelOrder(order.id));
      setCancelled(true);
    } catch (e) {
      setCancelError(e);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Shell
      title={t('paymentFailed.title')}
      body={
        cancelled
          ? t('paymentFailed.cancelled')
          : payable
            ? t('paymentFailed.body')
            : t('paymentFailed.notPayable')
      }
    >
      {payable ? (
        <Card className="mt-8 flex w-full max-w-xl flex-col gap-4 p-5 text-left">
          <h2 className="text-body-m font-semibold text-text-primary">
            {t('paymentFailed.chooseProvider')}
          </h2>
          <PaymentForm
            currency={order.grandTotal.currency}
            value={provider}
            onChange={setProvider}
          />
          {flow.state.phase === 'timeout' || flow.state.phase === 'failed' ? (
            <Alert variant="danger">
              <AlertDescription>
                {flow.state.phase === 'failed' && flow.state.error
                  ? describeError(locale, flow.state.error)
                  : flow.state.phase === 'timeout'
                    ? t('checkout.paymentTimeout')
                    : t('checkout.paymentFailed')}
              </AlertDescription>
            </Alert>
          ) : null}
          {cancelError ? (
            <Alert variant="danger">
              <AlertDescription>{describeError(locale, cancelError)}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              loading={busy}
              disabled={!provider || cancelling}
              onClick={() => provider && void flow.pay(order.id, provider)}
            >
              {busy ? t('paymentFailed.retrying') : t('paymentFailed.retry')}
            </Button>
            {canCancelOrder(order) ? (
              <Button
                variant="secondary"
                loading={cancelling}
                disabled={busy}
                onClick={() => void onCancel()}
              >
                {cancelling ? t('paymentFailed.cancelling') : t('paymentFailed.cancelOrder')}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href={`/account/orders/${order.id}`} variant="outline">
          {t('success.viewOrder')}
        </ButtonLink>
        <ButtonLink href="/account/orders" variant="outline">
          {t('paymentFailed.myOrders')}
        </ButtonLink>
      </div>
    </Shell>
  );
}

function PaymentFailedPage() {
  const { locale, t } = useLocale();
  const params = useSearchParams();
  const orderId = params.get('orderId');
  const errorCode = params.get('error');

  if (!orderId) {
    return (
      <Shell
        title={t('paymentFailed.title')}
        body={errorCode ? translateError(locale, errorCode) : t('paymentFailed.bodyNoOrder')}
      >
        <div className="mt-8">
          <ButtonLink href="/account/orders">{t('paymentFailed.myOrders')}</ButtonLink>
        </div>
      </Shell>
    );
  }
  return (
    <RequireAuth title="paymentFailed.signInTitle">
      <RetryPanel orderId={orderId} />
    </RequireAuth>
  );
}

export default function OrderPaymentFailedPage() {
  return (
    <React.Suspense fallback={null}>
      <PaymentFailedPage />
    </React.Suspense>
  );
}
