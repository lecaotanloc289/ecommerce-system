'use client';

import { Check, CreditCard, Package, PackageCheck, Star, Truck } from 'lucide-react';
import type { SubOrder } from '@repo/core';
import { formatDate } from '@repo/i18n';
import { useLocale, type MessageKey } from '../../i18n/use-locale';
import { subOrderTimeline, type TimelineStage } from '../../lib/order-status';
import { cn } from '../../lib/utils';

const STAGE: Record<TimelineStage, { icon: typeof Truck; label: MessageKey; event: MessageKey }> = {
  PAID: { icon: CreditCard, label: 'track.stage.paid', event: 'track.event.paid' },
  PROCESSING: { icon: Package, label: 'track.stage.packed', event: 'track.event.processing' },
  SHIPPED: { icon: Truck, label: 'track.stage.shipping', event: 'track.event.shipped' },
  DELIVERED: { icon: PackageCheck, label: 'track.stage.delivered', event: 'track.event.delivered' },
  COMPLETED: { icon: Star, label: 'track.stage.completed', event: 'track.event.completed' },
};

/**
 * Horizontal stepper + event list for one sub-order, derived from its status and timestamps
 * (`subOrderTimeline`). Same visual language as the original tracking page.
 */
export function OrderTimeline({ subOrder }: { subOrder: SubOrder }) {
  const { locale, t } = useLocale();
  const timeline = subOrderTimeline(subOrder);

  if (timeline.terminal) {
    const note: MessageKey =
      timeline.terminal === 'CANCELLED'
        ? 'orders.cancelledNote'
        : timeline.terminal === 'REFUNDED'
          ? 'orders.refundedNote'
          : 'orders.awaitingPaymentNote';
    return (
      <p className="text-body-m text-text-muted">
        {t(note)}
        {timeline.terminalAt ? ` ${formatDate(timeline.terminalAt, locale)}` : ''}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex items-center">
        {timeline.steps.map((step, i) => {
          const done = step.state === 'done';
          const active = step.state === 'current';
          const { icon: Icon, label } = STAGE[step.stage];
          return (
            <li
              key={step.stage}
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
                {i < timeline.steps.length - 1 ? (
                  <span
                    className={cn('h-0.5 flex-1', done ? 'bg-success-solid' : 'bg-border-default')}
                  />
                ) : null}
              </div>
              <span
                className={cn(
                  'mt-2 text-center text-body-s',
                  active ? 'font-medium text-text-primary' : 'text-text-muted',
                )}
              >
                {t(label)}
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="flex flex-col divide-y divide-border-faint">
        {timeline.steps
          .filter((s) => s.state !== 'upcoming')
          .map((step) => (
            <li key={step.stage} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-3 text-body-m text-text-body">
                <Check className="size-4 text-success-fg" />
                {t(STAGE[step.stage].event)}
              </span>
              {step.at ? (
                <span className="shrink-0 text-body-s text-text-muted">
                  {formatDate(step.at, locale)}
                </span>
              ) : null}
            </li>
          ))}
      </ul>
    </div>
  );
}
