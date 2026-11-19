'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CreditCard, MapPin, Pencil } from 'lucide-react';
import { Card } from '@repo/ui';
import { Container } from '../../../components/layout/container';
import { ButtonLink } from '../../../components/common/button-link';
import { StepTabs } from '../../../components/checkout/step-tabs';
import { OrderSummary } from '../../../components/checkout/order-summary';
import { useLocale } from '../../../i18n/locale-provider';
import { lineTotal } from '../../../lib/cart';
import { formatMoney } from '@repo/i18n';
import { useCart } from '../../../store/cart-store';
import { useCheckout, useOrderTotals } from '../../../store/checkout-store';

function ReviewCard({
  icon,
  title,
  editHref,
  children,
}: {
  icon: ReactNode;
  title: string;
  editHref: string;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-primary">
          <span className="text-brand-text">{icon}</span>
          <h2 className="text-body-m font-semibold">{title}</h2>
        </div>
        <Link
          href={editHref}
          aria-label={`${t('common.edit')}: ${title}`}
          className="inline-flex items-center gap-1 text-body-s font-medium text-brand-text hover:underline"
        >
          <Pencil className="size-3.5" aria-hidden />
        </Link>
      </div>
      {children}
    </Card>
  );
}

export default function CheckoutReviewPage() {
  const { locale, t } = useLocale();
  const { lines, totals, shippingMethod } = useOrderTotals();
  const { clear } = useCart();
  const { reset } = useCheckout();
  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('steps.review')}
      </h1>
      <StepTabs current="review" className="mt-6" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <ReviewCard
              icon={<MapPin className="size-5" />}
              title={t('checkout.shippingTo')}
              editHref="/checkout/info"
            >
              <div className="text-body-m text-text-body">
                <p className="font-medium text-text-primary">Gareth Barry</p>
                <p>+84 901 234 567</p>
                <p>123 Lê Lợi, Quận 1, TP. Hồ Chí Minh</p>
              </div>
              {shippingMethod ? (
                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3 text-body-s">
                  <span className="font-medium text-text-primary">{shippingMethod.name}</span>
                  {/* Same value the summary charges — both come from computeTotals. */}
                  {totals.shipping.amount > 0 ? (
                    <span className="font-semibold text-text-price">
                      {formatMoney(totals.shipping, locale)}
                    </span>
                  ) : (
                    <span className="text-success-fg">{t('summary.free')}</span>
                  )}
                </div>
              ) : null}
            </ReviewCard>
            <ReviewCard
              icon={<CreditCard className="size-5" />}
              title={t('checkout.paymentMethod')}
              editHref="/checkout/shipping"
            >
              <div className="text-body-m text-text-body">
                <p className="font-medium text-text-primary">{t('payment.stripe')}</p>
                <p>**** **** **** 4242</p>
              </div>
            </ReviewCard>
          </div>

          <div>
            <h2 className="mb-3 font-heading text-h5 font-semibold text-text-primary">
              {t('checkout.itemsInCart')}
            </h2>
            <Card className="divide-y divide-border-faint p-0">
              {lines.map((line) => (
                <div key={line.key} className="flex items-center gap-4 p-4">
                  <img
                    src={line.product.image}
                    alt={line.product.title}
                    width={64}
                    height={64}
                    className="size-16 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-body-m font-medium text-text-primary">
                      {line.product.title}
                    </p>
                    <p className="text-body-s text-text-muted">
                      {line.variantLabel ? `${line.variantLabel} · ` : ''}
                      {line.product.vendorName}
                    </p>
                  </div>
                  <span className="text-body-s text-text-muted">×{line.qty}</span>
                  <span className="text-body-m font-semibold text-text-price">
                    {formatMoney(lineTotal(line), locale)}
                  </span>
                </div>
              ))}
            </Card>
          </div>

          <ButtonLink href="/checkout/shipping" variant="outline" size="lg" className="w-fit">
            <ArrowLeft className="size-4" />
            {t('common.back')}
          </ButtonLink>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <OrderSummary
            lines={lines}
            totals={totals}
            showItems
            footer={
              lines.length > 0 ? (
                <ButtonLink
                  href="/order/success"
                  size="lg"
                  fullWidth
                  onClick={() => {
                    // Mock "place order": the cart and checkout choices are consumed.
                    clear();
                    reset();
                  }}
                >
                  {t('checkout.placeOrder')}
                </ButtonLink>
              ) : null
            }
          />
        </div>
      </div>
    </Container>
  );
}
