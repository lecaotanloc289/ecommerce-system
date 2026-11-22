'use client';

import { Check } from 'lucide-react';
import { useT } from '../../i18n/use-locale';
import type { MessageKey } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

export type CheckoutStep = 'cart' | 'info' | 'shipping' | 'review';

const STEPS: { key: CheckoutStep; label: MessageKey }[] = [
  { key: 'cart', label: 'steps.cart' },
  { key: 'info', label: 'steps.info' },
  { key: 'shipping', label: 'steps.shipping' },
  { key: 'review', label: 'steps.review' },
];

/** Progress tabs across the checkout flow (Parts/Shopping cart/Tab/01). */
export function StepTabs({ current, className }: { current: CheckoutStep; className?: string }) {
  const t = useT();
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <ol className={cn('flex items-center gap-2 overflow-x-auto sm:gap-4', className)}>
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={step.key} className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-body-s font-semibold transition-colors',
                  done && 'bg-success-solid text-text-on-primary',
                  active && 'bg-brand-solid text-text-on-primary',
                  !done && !active && 'bg-bg-muted text-text-muted',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-body-s font-medium sm:text-body-m',
                  active ? 'text-text-primary' : 'text-text-muted',
                )}
              >
                {t(step.label)}
              </span>
            </div>
            {i < STEPS.length - 1 ? (
              <span
                className={cn('h-px w-6 sm:w-10', done ? 'bg-success-solid' : 'bg-border-default')}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
