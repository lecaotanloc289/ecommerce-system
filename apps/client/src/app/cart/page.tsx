'use client';

import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Card } from '@repo/ui';
import { Container } from '../../components/layout/container';
import { ButtonLink } from '../../components/common/button-link';
import { SectionHeading } from '../../components/common/section-heading';
import { StepTabs } from '../../components/checkout/step-tabs';
import { ApplyVoucher } from '../../components/checkout/apply-voucher';
import { OrderSummary } from '../../components/checkout/order-summary';
import { QuantityStepper } from '../../components/checkout/quantity-stepper';
import { ProductCard } from '../../components/product/product-card';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney } from '../../lib/format';
import { cartGroups } from '../../mocks/cart';
import { products } from '../../mocks/products';

export default function CartPage() {
  const { locale, t } = useLocale();
  const lines = cartGroups.flatMap((g) => g.lines);
  const suggestions = products.slice(6, 12);

  return (
    <Container as="section" className="py-8 lg:py-12">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
            {t('cart.title')}
          </h1>
          <p className="mt-1 text-body-m text-text-muted">
            {lines.length} {t('summary.items')}
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
          {lines.map((line) => (
            <div key={`${line.product.id}-${line.variantLabel ?? ''}`} className="flex gap-4 p-4">
              <Link href={`/product/${line.product.slug}`} className="shrink-0">
                <img
                  src={line.product.image}
                  alt={line.product.title}
                  className="size-20 rounded-md object-cover"
                  loading="lazy"
                />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={`/product/${line.product.slug}`}>
                  <h3 className="line-clamp-2 text-body-m font-medium text-text-primary hover:text-brand-text">
                    {line.product.title}
                  </h3>
                </Link>
                <span className="text-body-s text-text-muted">{line.product.vendorName}</span>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-body-l font-bold text-text-price">
                    {formatMoney(line.product.price, locale)}
                  </span>
                  <div className="flex items-center gap-3">
                    <QuantityStepper value={line.qty} />
                    <button
                      type="button"
                      aria-label={t('cart.remove')}
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
            groups={cartGroups}
            shipping={{ amount: 60_000, currency: 'VND' }}
            discount={{ amount: 150_000, currency: 'VND' }}
            footer={
              <ButtonLink href="/checkout/info" size="lg" fullWidth>
                {t('cart.checkout')}
              </ButtonLink>
            }
          />
        </div>
      </div>

      {/* Suggestions */}
      <section className="mt-14">
        <SectionHeading title={t('cart.youMayLike')} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {suggestions.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </Container>
  );
}
