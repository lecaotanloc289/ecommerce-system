'use client';

import * as React from 'react';
import { CreditCard, Landmark } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@repo/ui';
import {
  PaymentProviderSchema,
  providerSupportsCurrency,
  type Currency,
  type PaymentProvider,
} from '@repo/core';
import { useT, type MessageKey } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

const PROVIDERS: Record<
  PaymentProvider,
  { icon: typeof Landmark; label: MessageKey; desc: MessageKey }
> = {
  VNPAY: { icon: Landmark, label: 'payment.vnpay', desc: 'payment.vnpayDesc' },
  STRIPE: { icon: CreditCard, label: 'payment.stripe', desc: 'payment.stripeDesc' },
};

/**
 * Payment provider picker. One provider pays the whole order; providers that can't charge the
 * cart currency (VNPay is VND-only) are disabled. Both providers redirect to a hosted page —
 * no card data is ever entered in the storefront.
 */
export function PaymentForm({
  currency,
  value,
  onChange,
  className,
}: {
  currency: Currency | null;
  value: PaymentProvider | null;
  onChange: (provider: PaymentProvider) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <RadioGroup
        value={value ?? ''}
        onValueChange={(v) => {
          const parsed = PaymentProviderSchema.safeParse(v);
          if (parsed.success) onChange(parsed.data);
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        {PaymentProviderSchema.options.map((provider) => {
          const { icon: Icon, label, desc } = PROVIDERS[provider];
          const supported = currency !== null && providerSupportsCurrency(provider, currency);
          return (
            <label
              key={provider}
              htmlFor={`pay-${provider}`}
              aria-disabled={!supported}
              className={cn(
                'flex flex-col gap-3 rounded-lg border border-border-default bg-bg-elevated p-4 transition-colors has-[:checked]:border-brand-solid has-[:checked]:bg-brand-soft/40',
                supported
                  ? 'cursor-pointer hover:border-border-strong'
                  : 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-md bg-bg-muted text-text-body">
                  <Icon className="size-5" />
                </span>
                <RadioGroupItem id={`pay-${provider}`} value={provider} disabled={!supported} />
              </div>
              <div>
                <p className="text-body-m font-medium text-text-primary">{t(label)}</p>
                <p className="text-body-s text-text-muted">{t(desc)}</p>
                {!supported && currency ? (
                  <p className="mt-1 text-body-s text-warning-fg">
                    {provider === 'VNPAY'
                      ? t('payment.vndOnly')
                      : t('payment.unsupportedFor', { currency })}
                  </p>
                ) : null}
              </div>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-body-s text-text-muted">{t('payment.hostedNote')}</p>
    </div>
  );
}
