'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Card } from '@repo/ui';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { StepTabs } from '@/components/checkout/step-tabs';
import { ApplyVoucher } from '@/components/checkout/apply-voucher';
import { OrderSummary } from '@/components/checkout/order-summary';
import { QuantityStepper } from '@/components/checkout/quantity-stepper';
import { ProductImage } from '@/components/product/product-image';
import { useLocale } from '@/i18n/use-locale';
import { formatMoney } from '@repo/i18n';
import { attributesLabel } from '@/lib/cart';
import { useCart } from '@/store/cart-store';
import { useOrderTotals } from '@/store/checkout-store';

export default function CartPage() {
  const { locale, t } = useLocale();
  const { setQty, remove, refresh } = useCart();
  const { hydrated, lines, totals } = useOrderTotals();

  // Re-read current price / stock / name (in this locale) of what the guest cart holds.
  React.useEffect(() => {
    if (hydrated) void refresh(locale);
  }, [hydrated, locale, refresh]);

  return (
    <Container as="section" className="py-8 lg:py-12">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
            {t('cart.title')}
          </h1>
          <p className="mt-1 text-body-m text-text-muted">
            {totals.itemCount} {t('summary.items')}
          </p>
        </div>
        <ButtonLink href="/search" variant="outline" size="md">
          <ArrowLeft className="size-4" />
          {t('cart.continueShopping')}
        </ButtonLink>
      </div>

      <StepTabs current="cart" className="mt-6" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
        {/* Left: flat line items */}
        <Card className="divide-y divide-border-faint p-0">
          {hydrated && lines.length === 0 ? (
            <p className="p-8 text-center text-body-m text-text-muted">{t('cart.empty')}</p>
          ) : null}
          {lines.map((line) => (
            <div key={line.variantId} className="flex gap-4 p-4">
              <Link href={`/product/${line.productSlug}`} className="shrink-0">
                <ProductImage
                  src={line.imageUrl}
                  alt={line.productName}
                  className="size-20 rounded-md"
                />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={`/product/${line.productSlug}`}>
                  <h3 className="line-clamp-2 text-body-m font-medium text-text-primary hover:text-brand-text">
                    {line.productName}
                  </h3>
                </Link>
                <span className="text-body-s text-text-muted">
                  {[attributesLabel(line.attributes), line.vendorName].filter(Boolean).join(' · ')}
                </span>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-body-l font-bold text-text-price">
                    {formatMoney(line.unitPrice, locale)}
                  </span>
                  <div className="flex items-center gap-3">
                    <QuantityStepper
                      value={line.quantity}
                      max={line.maxQty}
                      label={t('cart.qtyFor', { title: line.productName })}
                      onChange={(qty) => setQty(line.variantId, qty)}
                    />
                    <button
                      type="button"
                      onClick={() => remove(line.variantId)}
                      aria-label={t('cart.removeItem', { title: line.productName })}
                      className="inline-flex size-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* Right: voucher + summary */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <ApplyVoucher />
          <OrderSummary
            lines={lines}
            totals={totals}
            footer={
              lines.length > 0 ? (
                <ButtonLink href="/checkout/info" size="lg" fullWidth>
                  {t('cart.checkout')}
                </ButtonLink>
              ) : null
            }
          />
        </div>
      </div>
    </Container>
  );
}
