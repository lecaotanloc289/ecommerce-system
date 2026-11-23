'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle, Button, Card } from '@repo/ui';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { StepTabs } from '@/components/checkout/step-tabs';
import { CheckoutNotice } from '@/components/checkout/checkout-notice';
import { OrderSummary } from '@/components/checkout/order-summary';
import { QuantityStepper } from '@/components/checkout/quantity-stepper';
import { ProductImage } from '@/components/product/product-image';
import { useLocale } from '@/i18n/use-locale';
import { formatMoney } from '@repo/i18n';
import { describeError } from '@/lib/api/errors';
import { attributesLabel, payableLines } from '@/lib/cart';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth-provider';
import { useCart } from '@/store/cart-store';
import { useOrderTotals } from '@/store/checkout-store';

export default function CartPage() {
  const { locale, t } = useLocale();
  const { status } = useAuth();
  const { setQty, remove, refresh, busy, error, dismissError } = useCart();
  const { hydrated, lines, totals, hasMixedCurrency } = useOrderTotals();
  const payable = payableLines(lines);

  // Re-read current price / stock / name (in this locale): the server cart, or each guest product.
  React.useEffect(() => {
    if (hydrated) void refresh(locale);
  }, [hydrated, locale, refresh]);

  const canCheckout = payable.length > 0 && !hasMixedCurrency;

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

      <div className="mt-6 flex flex-col gap-3">
        <CheckoutNotice />
        {error ? (
          <Alert variant="danger">
            <AlertTitle>{t('common.errorTitle')}</AlertTitle>
            <AlertDescription>
              {describeError(locale, error)}{' '}
              <button type="button" onClick={dismissError} className="font-medium underline">
                {t('common.close')}
              </button>
            </AlertDescription>
          </Alert>
        ) : null}
        {hasMixedCurrency ? (
          <Alert variant="warning">
            <AlertTitle>{t('cart.mixedCurrencyTitle')}</AlertTitle>
            <AlertDescription>{t('cart.mixedCurrencyBody')}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
        {/* Left: flat line items */}
        <Card className="divide-y divide-border-faint p-0" aria-busy={busy}>
          {hydrated && lines.length === 0 ? (
            <p className="p-8 text-center text-body-m text-text-muted">{t('cart.empty')}</p>
          ) : null}
          {lines.map((line) => (
            <div
              key={line.variantId}
              className={cn('flex gap-4 p-4', line.unavailable && 'bg-bg-muted/40')}
            >
              <Link
                href={`/product/${line.productSlug}`}
                className={cn('shrink-0', line.unavailable && 'opacity-50 grayscale')}
              >
                <ProductImage
                  src={line.imageUrl}
                  alt={line.productName}
                  className="size-20 rounded-md"
                />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={`/product/${line.productSlug}`}>
                  <h3
                    className={cn(
                      'line-clamp-2 text-body-m font-medium hover:text-brand-text',
                      line.unavailable ? 'text-text-muted line-through' : 'text-text-primary',
                    )}
                  >
                    {line.productName}
                  </h3>
                </Link>
                <span className="text-body-s text-text-muted">
                  {[attributesLabel(line.attributes), line.vendorName].filter(Boolean).join(' · ')}
                </span>
                {line.unavailable ? (
                  <p role="status" className="text-body-s text-warning-fg">
                    <span className="font-semibold">{t('cart.unavailable')}.</span>{' '}
                    {t('cart.unavailableHint')}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span
                    className={cn(
                      'text-body-l font-bold',
                      line.unavailable ? 'text-text-muted' : 'text-text-price',
                    )}
                  >
                    {formatMoney(line.unitPrice, locale)}
                  </span>
                  <div className="flex items-center gap-3">
                    {line.unavailable ? (
                      <span className="text-body-s text-text-muted">×{line.quantity}</span>
                    ) : (
                      <QuantityStepper
                        value={line.quantity}
                        max={Math.max(1, line.maxQty)}
                        label={t('cart.qtyFor', { title: line.productName })}
                        onChange={(qty) => void setQty(line.variantId, qty)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(line.variantId)}
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

        {/* Right: summary */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
          <OrderSummary
            lines={payable}
            totals={totals}
            estimate
            footer={
              lines.length === 0 ? null : !canCheckout ? (
                <Button size="lg" fullWidth disabled>
                  {t('cart.checkout')}
                </Button>
              ) : status === 'authenticated' ? (
                <ButtonLink href="/checkout/info" size="lg" fullWidth>
                  {t('cart.checkout')}
                </ButtonLink>
              ) : (
                <ButtonLink
                  href={`/sign-in?${new URLSearchParams({ returnTo: '/checkout/info' }).toString()}`}
                  size="lg"
                  fullWidth
                >
                  {t('cart.signInToCheckout')}
                </ButtonLink>
              )
            }
          />
        </div>
      </div>
    </Container>
  );
}
