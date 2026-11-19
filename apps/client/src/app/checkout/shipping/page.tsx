'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Card } from '@repo/ui';
import { Container } from '../../../components/layout/container';
import { ButtonLink } from '../../../components/common/button-link';
import { StepTabs } from '../../../components/checkout/step-tabs';
import { ShippingPicker } from '../../../components/checkout/shipping-picker';
import { PaymentForm } from '../../../components/checkout/payment-form';
import { OrderSummary } from '../../../components/checkout/order-summary';
import { useT } from '../../../i18n/locale-provider';
import { useOrderTotals } from '../../../store/checkout-store';

export default function CheckoutShippingPage() {
  const t = useT();
  const { lines, totals } = useOrderTotals();
  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('steps.shipping')}
      </h1>
      <StepTabs current="shipping" className="mt-6" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4 p-5 lg:p-6">
            <h2 className="font-heading text-h5 font-semibold text-text-primary">
              {t('checkout.chooseShipping')}
            </h2>
            <ShippingPicker />
          </Card>

          <Card className="flex flex-col gap-4 p-5 lg:p-6">
            <h2 className="font-heading text-h5 font-semibold text-text-primary">
              {t('checkout.paymentWith')}
            </h2>
            <PaymentForm />
          </Card>

          <div className="flex flex-wrap justify-between gap-3">
            <ButtonLink href="/checkout/info" variant="outline" size="lg">
              <ArrowLeft className="size-4" />
              {t('common.back')}
            </ButtonLink>
            {lines.length > 0 ? (
              <ButtonLink href="/checkout/review" size="lg">
                {t('common.continue')}
                <ArrowRight className="size-4" />
              </ButtonLink>
            ) : null}
          </div>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <OrderSummary
            lines={lines}
            totals={totals}
            showItems
            footer={
              lines.length > 0 ? (
                <ButtonLink href="/checkout/review" size="lg" fullWidth>
                  {t('steps.review')}
                </ButtonLink>
              ) : null
            }
          />
        </div>
      </div>
    </Container>
  );
}
