'use client';

import { ShieldCheck, Headphones, Truck, CreditCard } from 'lucide-react';
import { Container } from '../layout/container';
import { useLocale } from '../../i18n/locale-provider';
import type { MessageKey } from '../../i18n/locale-provider';
import { formatMoney } from '@repo/i18n';
import { platformSettings } from '../../mocks/platform-settings';

const items: { icon: typeof Truck; title: MessageKey; desc: MessageKey }[] = [
  { icon: Truck, title: 'benefit.freeShipping', desc: 'benefit.freeShippingDesc' },
  { icon: ShieldCheck, title: 'benefit.moneyGuarantee', desc: 'benefit.moneyGuaranteeDesc' },
  { icon: Headphones, title: 'benefit.support', desc: 'benefit.supportDesc' },
  { icon: CreditCard, title: 'benefit.payment', desc: 'benefit.paymentDesc' },
];

/** Trust-strip (Elements/Benefit/001). */
export function BenefitBar() {
  const { locale, t } = useLocale();
  // Only freeShippingDesc interpolates {amount}; extra params are ignored by the others.
  const params = { amount: formatMoney(platformSettings.freeShippingThreshold, locale) };
  return (
    <section className="border-y border-border-faint bg-bg-muted/30">
      <Container className="grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
        {items.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-body-m font-semibold text-text-primary">{t(title)}</p>
              <p className="truncate text-body-s text-text-muted">{t(desc, params)}</p>
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}
