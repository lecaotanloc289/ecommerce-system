'use client';

import Link from 'next/link';
import { Check, CreditCard, Package, PackageCheck, Phone, Star, Truck } from 'lucide-react';
import { Button, Card } from '@repo/ui';
import { Container } from '../../../components/layout/container';
import { ButtonLink } from '../../../components/common/button-link';
import { OrderSummary } from '../../../components/checkout/order-summary';
import { useLocale } from '../../../i18n/locale-provider';
import { formatDate } from '../../../lib/format';
import { trackingSteps, cartGroups } from '../../../mocks/cart';
import { cn } from '../../../lib/utils';

const stages = [
  { icon: CreditCard, label: 'Order paid' },
  { icon: Package, label: 'Packed' },
  { icon: Truck, label: 'On shipping' },
  { icon: PackageCheck, label: 'Delivered' },
  { icon: Star, label: 'Completed' },
];
const currentStage = 2; // On shipping

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
                  {t('track.trackingNumber')}: FDX-991-2261-VN
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
                      {stage.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Track details */}
          <Card className="flex flex-col gap-4 p-5 lg:p-6">
            <h2 className="font-heading text-h6 font-semibold text-text-primary">Track details</h2>
            <ul className="flex flex-col divide-y divide-border-faint">
              {trackingSteps.map((step) => (
                <li key={step.status} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-3 text-body-m text-text-body">
                    <Check
                      className={cn('size-4', step.done ? 'text-success-fg' : 'text-text-disabled')}
                    />
                    {step.label}
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
            <p className="text-body-m text-text-body">Have trouble with your package?</p>
            <Button variant="dark" iconLeft={<Phone className="size-4" />}>
              Call Us
            </Button>
          </Card>
        </div>

        {/* Inside package + summary */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <OrderSummary
            groups={cartGroups}
            showItems
            shipping={{ amount: 60_000, currency: 'VND' }}
            discount={{ amount: 150_000, currency: 'VND' }}
            footer={
              <Link
                href="/"
                className="text-center text-body-s font-medium text-brand-text hover:underline"
              >
                {t('common.viewAll')}
              </Link>
            }
          />
        </div>
      </div>
    </Container>
  );
}
