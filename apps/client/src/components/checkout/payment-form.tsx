'use client';

import * as React from 'react';
import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { Input, Label, RadioGroup, RadioGroupItem } from '@repo/ui';
import { useT } from '../../i18n/locale-provider';
import type { MessageKey } from '../../i18n/locale-provider';
import type { PaymentProviderId } from '../../types';
import { cn } from '../../lib/utils';

const methods: {
  id: PaymentProviderId;
  icon: typeof Wallet;
  label: MessageKey;
  desc: MessageKey;
}[] = [
  { id: 'vnpay', icon: Landmark, label: 'payment.vnpay', desc: 'payment.vnpayDesc' },
  { id: 'stripe', icon: CreditCard, label: 'payment.stripe', desc: 'payment.stripeDesc' },
  { id: 'wallet', icon: Wallet, label: 'payment.wallet', desc: 'payment.walletDesc' },
];

/** Payment provider picker (Parts/Chekout/Form/Payment with/001). One provider
 * applies to the whole order (storefront CLAUDE.md §10). */
export function PaymentForm({ className }: { className?: string }) {
  const t = useT();
  const [selected, setSelected] = React.useState<PaymentProviderId>('stripe');

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <RadioGroup
        value={selected}
        onValueChange={(v) => {
          const match = methods.find((m) => m.id === v);
          if (match) setSelected(match.id);
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        {methods.map((m) => {
          const Icon = m.icon;
          return (
            <label
              key={m.id}
              htmlFor={`pay-${m.id}`}
              className="flex cursor-pointer flex-col gap-3 rounded-lg border border-border-default bg-bg-elevated p-4 transition-colors hover:border-border-strong has-[:checked]:border-brand-solid has-[:checked]:bg-brand-soft/40"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-md bg-bg-muted text-text-body">
                  <Icon className="size-5" />
                </span>
                <RadioGroupItem id={`pay-${m.id}`} value={m.id} />
              </div>
              <div>
                <p className="text-body-m font-medium text-text-primary">{t(m.label)}</p>
                <p className="text-body-s text-text-muted">{t(m.desc)}</p>
              </div>
            </label>
          );
        })}
      </RadioGroup>

      {/* Card details — only for the Stripe card flow */}
      {selected === 'stripe' ? (
        <form
          className="grid gap-4 rounded-lg border border-border-subtle bg-bg-muted/30 p-4 sm:grid-cols-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cardNumber">{t('checkout.cardNumber')}</Label>
            <Input id="cardNumber" inputMode="numeric" placeholder="1234 5678 9012 3456" />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="cardName">{t('checkout.cardName')}</Label>
            <Input id="cardName" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiry">{t('checkout.expiry')}</Label>
            <Input id="expiry" placeholder="MM/YY" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cvc">{t('checkout.cvc')}</Label>
            <Input id="cvc" inputMode="numeric" placeholder="123" />
          </div>
        </form>
      ) : null}
    </div>
  );
}
