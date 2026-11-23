'use client';

import * as React from 'react';
import { Truck } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@repo/ui';
import type { CartShippingOptions } from '@repo/core';
import { formatMoney } from '@repo/i18n';
import { useLocale } from '../../i18n/use-locale';
import { payableLines, type CartLineView } from '../../lib/cart';
import { cartCurrency, methodsForVendor, resolveShipping, vendorIdsOf } from '../../lib/checkout';
import { cn } from '../../lib/utils';
import { useCheckout } from '../../store/checkout-store';

/**
 * One shipping method per vendor (a multi-vendor cart ships in separate parcels). Methods come
 * from `GET /v1/cart/shipping-options`; the cheapest is preselected and a stale pick is replaced.
 */
export function ShippingPicker({
  lines,
  options,
  failed,
  className,
}: {
  lines: readonly CartLineView[];
  options: CartShippingOptions | null;
  failed: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const { choices, setShipping, setShippingFor } = useCheckout();
  const currency = cartCurrency(lines);
  const vendorIds = vendorIdsOf(lines);
  const vendorNames = new Map<string, string>(
    payableLines(lines).map((l) => [l.vendorId, l.vendorName] as const),
  );

  React.useEffect(() => {
    if (!options) return;
    const next = resolveShipping(choices.shipping, vendorIds, options, currency);
    if (JSON.stringify(next) !== JSON.stringify(choices.shipping)) setShipping(next);
    // vendorIds is derived from `lines`; the joined key keeps the dependency primitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, currency, vendorIds.join(','), choices.shipping, setShipping]);

  if (failed) {
    return (
      <p role="alert" className="text-body-m text-danger-fg">
        {t('checkout.shippingLoadFailed')}
      </p>
    );
  }
  if (!options) {
    return (
      <p role="status" className="text-body-m text-text-muted">
        {t('checkout.loadingShipping')}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {vendorIds.map((vendorId) => {
        const vendor = vendorNames.get(vendorId) ?? '';
        const methods = methodsForVendor(options, vendorId, currency);
        return (
          <fieldset key={vendorId} className="flex flex-col gap-3">
            <legend className="mb-1 text-body-m font-semibold text-text-primary">
              {t('checkout.shippingFor', { vendor })}
            </legend>
            {methods.length === 0 ? (
              <p role="alert" className="text-body-m text-danger-fg">
                {t('checkout.noShippingMethods', { vendor })}
              </p>
            ) : (
              <RadioGroup
                value={choices.shipping[vendorId] ?? ''}
                onValueChange={(id) => setShippingFor(vendorId, id)}
                aria-label={t('checkout.shippingFor', { vendor })}
                className="flex flex-col gap-3"
              >
                {methods.map((m) => (
                  <label
                    key={m.id}
                    htmlFor={`ship-${m.id}`}
                    className="flex cursor-pointer items-center gap-4 rounded-lg border border-border-default bg-bg-elevated p-4 transition-colors hover:border-border-strong has-[:checked]:border-brand-solid has-[:checked]:bg-brand-soft/40"
                  >
                    <RadioGroupItem id={`ship-${m.id}`} value={m.id} />
                    <span className="flex size-10 items-center justify-center rounded-md bg-bg-muted text-text-body">
                      <Truck className="size-5" />
                    </span>
                    <div className="flex-1">
                      <p className="text-body-m font-medium text-text-primary">{m.name}</p>
                      <p className="text-body-s text-text-muted">
                        {t('checkout.etaDays', { days: m.estDays })}
                      </p>
                    </div>
                    {m.price.amount > 0 ? (
                      <span className="text-body-m font-semibold text-text-price">
                        {formatMoney(m.price, locale)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-bg px-2.5 py-1 text-body-s font-medium text-success-fg">
                        {t('summary.free')}
                      </span>
                    )}
                  </label>
                ))}
              </RadioGroup>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
