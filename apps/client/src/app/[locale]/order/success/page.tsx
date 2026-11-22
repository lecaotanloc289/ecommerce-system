'use client';

import { Link } from '@/i18n/navigation';
import { CheckCircle2, ChevronLeft, Truck } from 'lucide-react';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { useT } from '@/i18n/use-locale';
import { placedOrder } from '@/mocks/cart';

export default function OrderSuccessPage() {
  const t = useT();
  const orderNumber = placedOrder.number;

  return (
    <Container as="section" className="flex flex-col items-center py-16 text-center lg:py-24">
      <span className="flex size-24 items-center justify-center rounded-full bg-brand-soft/40">
        <span className="flex size-16 items-center justify-center rounded-full bg-bg-elevated text-brand-text shadow-1">
          <CheckCircle2 className="size-9" />
        </span>
      </span>

      <h1 className="mt-6 font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
        {t('success.title')}
      </h1>
      <p className="mt-4 max-w-lg text-body-l text-text-muted">
        {t('success.subtitle')}{' '}
        <span className="font-semibold text-text-primary">
          {t('success.orderNumber')} {orderNumber}
        </span>
      </p>

      <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-body-m font-semibold text-brand-text hover:underline"
        >
          <ChevronLeft className="size-4" />
          {t('success.keepShopping')}
        </Link>
        <ButtonLink href="/order/track" size="lg" variant="dark">
          <Truck className="size-5" />
          {t('success.trackOrder')}
        </ButtonLink>
      </div>
    </Container>
  );
}
