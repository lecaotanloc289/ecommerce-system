'use client';

import { Check, CreditCard, Package, PackageCheck, Phone, Star, Truck } from 'lucide-react';
import { Button, Card } from '@repo/ui';
import { Container } from '../../../components/layout/container';
import { ButtonLink } from '../../../components/common/button-link';
import { OrderSummary } from '../../../components/checkout/order-summary';
import { useLocale, type MessageKey } from '../../../i18n/locale-provider';
import { computeTotals } from '../../../lib/cart';
import { formatDate } from '@repo/i18n';
import {
  findShippingMethod,
  findVoucher,
  placedOrder,
  resolveCartLine,
  trackingSteps,
} from '../../../mocks/cart';
import { platformSettings } from '../../../mocks/platform-settings';
import { cn } from '../../../lib/utils';
import type { OrderStatus } from '../../../types';

const stages: { icon: typeof Truck; label: MessageKey }[] = [
  { icon: CreditCard, label: 'track.stage.paid' },
  { icon: Package, label: 'track.stage.packed' },
  { icon: Truck, label: 'track.stage.shipping' },
  { icon: PackageCheck, label: 'track.stage.delivered' },
  { icon: Star, label: 'track.stage.completed' },
];

const EVENT_LABEL: Record<OrderStatus, MessageKey> = {
  AWAITING_PAYMENT: 'track.event.awaitingPayment',
  PAID: 'track.event.paid',
  PROCESSING: 'track.event.processing',
  SHIPPED: 'track.event.shipped',
  DELIVERED: 'track.event.delivered',
  COMPLETED: 'track.event.completed',
};

// The active stage is the latest completed tracking event.
const currentStage = trackingSteps.filter((s) => s.done).length - 1;

// A placed order is a snapshot — totals come from the order, not the live cart.
const orderLines = placedOrder.lines.map(resolveCartLine);
const orderTotals = computeTotals(
  orderLines,
  findShippingMethod(placedOrder.shippingMethodId),
  findVoucher(placedOrder.voucherCode),
  platformSettings.defaultCurrency,
);

export default function TrackOrderPage() {
  const { locale, t } = useLocale();

  return (
    <Container as="section" className="py-8 lg:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
          {t('track.title')}
        </h1>
        <ButtonLink href="/" variant="outline" size="md">
          {t('common.home')}
        </ButtonLink>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
        <div className="flex flex-col gap-6">
          {/* Horizontal stepper */}
          <Card className="flex flex-col gap-6 p-5 lg:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-body-m font-semibold text-text-primary">
                  {t('track.yourPackage')}
                </p>
                <p className="text-body-s text-text-muted">
                  {t('track.trackingNumber')}: {placedOrder.trackingNumber}
                </p>
              </div>
            </div>
            <ol className="flex items-center">
              {stages.map((stage, i) => {
                const done = i < currentStage;
                const active = i === currentStage;
                const Icon = stage.icon;
                return (
                  <li
                    key={stage.label}
                    aria-current={active ? 'step' : undefined}
                    className="flex flex-1 flex-col items-center last:flex-none"
                  >
                    <div className="flex w-full items-center">
                      <span
                        className={cn(
                          'mx-auto flex size-10 shrink-0 items-center justify-center rounded-full',
                          done && 'bg-success-solid text-text-on-primary',
                          active && 'bg-brand-solid text-text-on-primary',
                          !done && !active && 'bg-bg-muted text-text-muted',
                        )}
                      >
                        {done ? <Check className="size-5" /> : <Icon className="size-5" />}
                      </span>
                      {i < stages.length - 1 ? (
                        <span
                          className={cn(
                            'h-0.5 flex-1',
                            done ? 'bg-success-solid' : 'bg-border-default',
                          )}
                        />
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        'mt-2 text-center text-body-s',
                        active ? 'font-medium text-text-primary' : 'text-text-muted',
                      )}
                    >
                      {t(stage.label)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Track details */}
          <Card className="flex flex-col gap-4 p-5 lg:p-6">
            <h2 className="font-heading text-h6 font-semibold text-text-primary">
              {t('track.details')}
            </h2>
            <ul className="flex flex-col divide-y divide-border-faint">
              {trackingSteps.map((step) => (
                <li key={step.status} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-3 text-body-m text-text-body">
                    <Check
                      className={cn('size-4', step.done ? 'text-success-fg' : 'text-text-disabled')}
                    />
                    {t(EVENT_LABEL[step.status])}
                  </span>
                  <span className="shrink-0 text-body-s text-text-muted">
                    {formatDate(step.at, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Help */}
          <Card className="flex flex-wrap items-center justify-between gap-3 bg-bg-muted/40 p-5">
            <p className="text-body-m text-text-body">{t('track.help')}</p>
            <Button variant="dark" iconLeft={<Phone className="size-4" />}>
              {t('track.callUs')}
            </Button>
          </Card>
        </div>

        {/* Inside package + summary */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <OrderSummary lines={orderLines} totals={orderTotals} showItems />
        </div>
      </div>
    </Container>
  );
}
