'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Clock, XCircle } from 'lucide-react';
import { Button } from '@repo/ui';
import type { Order } from '@repo/core';
import { Link } from '@/i18n/navigation';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { RequireAuth } from '@/components/auth/require-auth';
import { shortOrderId } from '@/components/order/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { fetchOrder } from '@/lib/api/commerce';
import { describeError } from '@/lib/api/errors';
import { waitForOrderPayment } from '@/lib/order-poll';
import { paymentOutcome } from '@/lib/order-status';

type View =
  | { kind: 'loading' }
  | { kind: 'done'; order: Order }
  | { kind: 'pending'; order: Order | null }
  | { kind: 'error'; error: unknown };

function Banner({
  tone,
  icon,
  title,
  body,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  const ring =
    tone === 'success'
      ? 'text-brand-text'
      : tone === 'warning'
        ? 'text-warning-fg'
        : 'text-danger-fg';
  return (
    <Container as="section" className="flex flex-col items-center py-16 text-center lg:py-24">
      <span className="flex size-24 items-center justify-center rounded-full bg-brand-soft/40">
        <span
          className={`flex size-16 items-center justify-center rounded-full bg-bg-elevated shadow-1 ${ring}`}
        >
          {icon}
        </span>
      </span>
      <h1 className="mt-6 font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
        {title}
      </h1>
      <p className="mt-4 max-w-lg text-body-l text-text-muted">{body}</p>
      {children}
    </Container>
  );
}

function SuccessContent({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const [view, setView] = React.useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setView({ kind: 'loading' });
    waitForOrderPayment({ fetchOrder: () => fetchOrder(orderId), signal: controller.signal }).then(
      (result) => {
        if (result.kind === 'settled') setView({ kind: 'done', order: result.order });
        else if (result.kind === 'pending') setView({ kind: 'pending', order: result.order });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setView({ kind: 'error', error });
      },
    );
    return () => controller.abort();
  }, [orderId, attempt]);

  const orderLink = (
    <ButtonLink href={`/account/orders/${orderId}`} size="lg" variant="dark">
      {t('success.viewOrder')}
    </ButtonLink>
  );

  if (view.kind === 'error') {
    return (
      <Banner
        tone="danger"
        icon={<XCircle className="size-9" />}
        title={t('success.loadFailed')}
        body={describeError(locale, view.error)}
      />
    );
  }
  if (view.kind === 'loading') {
    return (
      <Banner
        tone="warning"
        icon={<Clock className="size-9 animate-pulse" />}
        title={t('success.pendingTitle')}
        body={t('success.pendingBody')}
      />
    );
  }
  if (view.kind === 'pending') {
    return (
      <Banner
        tone="warning"
        icon={<Clock className="size-9" />}
        title={t('success.stillPendingTitle')}
        body={t('success.stillPendingBody')}
      >
        <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
          <Button size="lg" onClick={() => setAttempt((n) => n + 1)}>
            {t('success.checkAgain')}
          </Button>
          {orderLink}
        </div>
      </Banner>
    );
  }
  if (paymentOutcome(view.order.status) === 'cancelled') {
    return (
      <Banner
        tone="danger"
        icon={<XCircle className="size-9" />}
        title={t('success.cancelledTitle')}
        body={t('success.cancelledBody')}
      >
        <div className="mt-8">{orderLink}</div>
      </Banner>
    );
  }
  return (
    <Banner
      tone="success"
      icon={<CheckCircle2 className="size-9" />}
      title={t('success.title')}
      body={`${t('success.subtitle')} ${t('success.orderNumber')} ${shortOrderId(view.order.id)}`}
    >
      <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-body-m font-semibold text-brand-text hover:underline"
        >
          <ChevronLeft className="size-4" />
          {t('success.keepShopping')}
        </Link>
        <ButtonLink href={`/account/orders/${view.order.id}`} size="lg" variant="dark">
          {t('success.trackOrder')}
        </ButtonLink>
      </div>
    </Banner>
  );
}

function SuccessPage() {
  const t = useLocale().t;
  const orderId = useSearchParams().get('orderId');
  if (!orderId) {
    return (
      <Container as="section" className="py-16 text-center text-body-l text-text-muted">
        <p>{t('success.missingOrder')}</p>
        <div className="mt-6">
          <ButtonLink href="/account/orders">{t('paymentFailed.myOrders')}</ButtonLink>
        </div>
      </Container>
    );
  }
  return (
    <RequireAuth title="success.signInTitle">
      <SuccessContent orderId={orderId} />
    </RequireAuth>
  );
}

export default function OrderSuccessPage() {
  return (
    <React.Suspense fallback={null}>
      <SuccessPage />
    </React.Suspense>
  );
}
