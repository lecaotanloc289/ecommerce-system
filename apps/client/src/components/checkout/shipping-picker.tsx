'use client';

import { Truck } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@repo/ui';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney } from '../../lib/format';
import { shippingMethods } from '../../mocks/cart';
import { useCheckout } from '../../store/checkout-store';
import { cn } from '../../lib/utils';

/** Choose-shipping list (Parts/Checkout/730px/Choose shipping). Selection lives in the checkout store. */
export function ShippingPicker({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const { shippingMethodId, setShippingMethodId } = useCheckout();
  return (
    <RadioGroup
      value={shippingMethodId}
      onValueChange={setShippingMethodId}
      aria-label={t('checkout.chooseShipping')}
      className={cn('flex flex-col gap-3', className)}
    >
      {shippingMethods.map((m) => (
        <label
          key={m.id}
          htmlFor={m.id}
          className="flex cursor-pointer items-center gap-4 rounded-lg border border-border-default bg-bg-elevated p-4 transition-colors hover:border-border-strong has-[:checked]:border-brand-solid has-[:checked]:bg-brand-soft/40"
        >
          <RadioGroupItem id={m.id} value={m.id} />
          <span className="flex size-10 items-center justify-center rounded-md bg-bg-muted text-text-body">
            <Truck className="size-5" />
          </span>
          <div className="flex-1">
            <p className="text-body-m font-medium text-text-primary">{m.name}</p>
            <p className="text-body-s text-text-muted">
              {t('checkout.eta', { min: m.eta.minDays, max: m.eta.maxDays })}
            </p>
          </div>
          {m.fee.amount > 0 ? (
            <span className="text-body-m font-semibold text-text-price">
              {formatMoney(m.fee, locale)}
            </span>
          ) : (
            <span className="rounded-full bg-success-bg px-2.5 py-1 text-body-s font-medium text-success-fg">
              {t('summary.free')}
            </span>
          )}
        </label>
      ))}
    </RadioGroup>
  );
}
