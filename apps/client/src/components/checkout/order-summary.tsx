'use client';

import type { ReactNode } from 'react';
import { Card } from '@repo/ui';
import { useLocale } from '../../i18n/use-locale';
import type { OrderTotals } from '../../lib/cart';
import { attributesLabel, lineTotal, type CartLineView } from '../../lib/cart';
import { formatMoney } from '@repo/i18n';
import { cn } from '../../lib/utils';
import { ProductImage } from '../product/product-image';

/**
 * Order Summary card (Parts/Additional/Order Summary/001–004). Pure display of
 * `computeTotals` output — callers pass lines + totals (usually from
 * `useOrderTotals()`). `footer`/`children` slot in a CTA or extra content per screen.
 */
export function OrderSummary({
  lines,
  totals,
  footer,
  children,
  showItems = false,
  className,
}: {
  lines: CartLineView[];
  totals: OrderTotals;
  footer?: ReactNode;
  children?: ReactNode;
  showItems?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const { itemCount, subtotal, shipping, discount, total } = totals;

  return (
    <Card className={cn('flex flex-col gap-4 p-5', className)}>
      <h2 className="font-heading text-h5 font-semibold text-text-primary">{t('summary.title')}</h2>

      {showItems && lines.length > 0 ? (
        <ul className="flex flex-col gap-3 border-b border-border-subtle pb-4">
          {lines.map((line) => (
            <li key={line.variantId} className="flex items-center gap-3">
              <ProductImage
                src={line.imageUrl}
                alt={line.productName}
                className="size-12 shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-1 text-body-s font-medium text-text-primary">
                  {line.productName}
                </p>
                <p className="text-body-s text-text-muted">
                  {[attributesLabel(line.attributes), `×${line.quantity}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className="text-body-s font-semibold text-text-price">
                {formatMoney(lineTotal(line), locale)}
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
          value={shipping.amount > 0 ? formatMoney(shipping, locale) : t('summary.free')}
          muted={shipping.amount === 0}
        />
        {discount.amount > 0 ? (
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
