'use client';

import type { ReactNode } from 'react';
import { Card } from '@repo/ui';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney, sumMoney } from '../../lib/format';
import { cn } from '../../lib/utils';
import type { CartVendorGroup, Money } from '../../types';

/** Subtotal in the cart's currency; `sumMoney` throws if lines mix currencies. */
function subtotalOf(groups: CartVendorGroup[]): Money {
  const lines = groups.flatMap((g) => g.lines);
  const currency = lines[0]?.product.price.currency ?? 'VND';
  return sumMoney(
    lines.map((l) => ({
      amount: l.product.price.amount * l.qty,
      currency: l.product.price.currency,
    })),
    currency,
  );
}

/**
 * Order Summary card (Parts/Additional/Order Summary/001–004). Computes subtotal
 * from cart groups; shipping/discount are optional. `footer`/`children` slot in a
 * CTA or thumbnail list per screen.
 */
export function OrderSummary({
  groups,
  shipping,
  discount,
  footer,
  children,
  showItems = false,
  className,
}: {
  groups: CartVendorGroup[];
  shipping?: Money;
  discount?: Money;
  footer?: ReactNode;
  children?: ReactNode;
  showItems?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const subtotal = subtotalOf(groups);
  const lines = groups.flatMap((g) => g.lines);
  const itemCount = lines.reduce((m, l) => m + l.qty, 0);
  const gross = sumMoney([subtotal, ...(shipping ? [shipping] : [])], subtotal.currency);
  const off = sumMoney(discount ? [discount] : [], subtotal.currency);
  // A discount can never push the total below zero.
  const total: Money = {
    amount: Math.max(0, gross.amount - off.amount),
    currency: subtotal.currency,
  };

  return (
    <Card className={cn('flex flex-col gap-4 p-5', className)}>
      <h2 className="font-heading text-h5 font-semibold text-text-primary">{t('summary.title')}</h2>

      {showItems ? (
        <ul className="flex flex-col gap-3 border-b border-border-subtle pb-4">
          {lines.map((line) => (
            <li
              key={`${line.product.id}-${line.variantLabel ?? ''}`}
              className="flex items-center gap-3"
            >
              <img
                src={line.product.image}
                alt={line.product.title}
                className="size-12 shrink-0 rounded-md object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-body-s font-medium text-text-primary">
                  {line.product.title}
                </p>
                <p className="text-body-s text-text-muted">×{line.qty}</p>
              </div>
              <span className="text-body-s font-semibold text-text-price">
                {formatMoney(line.product.price, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {children}

      <dl className="flex flex-col gap-2.5 text-body-m">
        <Row
          label={`${t('summary.subtotal')} (${itemCount} ${t('summary.items')})`}
          value={formatMoney(subtotal, locale)}
        />
        <Row
          label={t('summary.shipping')}
          value={
            shipping && shipping.amount > 0 ? formatMoney(shipping, locale) : t('summary.free')
          }
          muted={!shipping || shipping.amount === 0}
        />
        {discount && discount.amount > 0 ? (
          <Row
            label={t('summary.discount')}
            value={`− ${formatMoney(discount, locale)}`}
            tone="success"
          />
        ) : null}
      </dl>

      <div className="border-t border-border-subtle pt-4">
        <div className="flex items-center justify-between">
          <span className="text-body-m font-semibold text-text-primary">{t('summary.total')}</span>
          <span className="text-h5 font-bold text-text-price">{formatMoney(total, locale)}</span>
        </div>
      </div>

      {footer}
    </Card>
  );
}

function Row({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'success';
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd
        className={cn(
          'font-medium',
          tone === 'success' ? 'text-success-fg' : muted ? 'text-text-muted' : 'text-text-primary',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
