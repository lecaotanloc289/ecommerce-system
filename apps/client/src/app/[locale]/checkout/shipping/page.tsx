'use client';

import * as React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button, Card } from '@repo/ui';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { StepTabs } from '@/components/checkout/step-tabs';
import { ShippingPicker } from '@/components/checkout/shipping-picker';
import { PaymentForm } from '@/components/checkout/payment-form';
import { CheckoutNotice } from '@/components/checkout/checkout-notice';
import { OrderSummary } from '@/components/checkout/order-summary';
import { useCheckoutGuard } from '@/components/checkout/use-checkout-guard';
import { useT } from '@/i18n/use-locale';
import { payableLines } from '@/lib/cart';
import { cartCurrency, methodsForVendor, resolveProvider, vendorIdsOf } from '@/lib/checkout';
import { useCheckout, useOrderTotals } from '@/store/checkout-store';

export default function CheckoutShippingPage() {
  const t = useT();
  const { ready, shippingOptions, shippingFailed } = useCheckoutGuard('shipping');
  const { lines, totals } = useOrderTotals(shippingOptions);
  const { choices, setProvider } = useCheckout();
  const currency = cartCurrency(lines);

  // Keep the provider valid for the cart currency (VNPay is VND-only); preselect one otherwise.
  React.useEffect(() => {
    if (!ready) return;
    const next = resolveProvider(choices.provider, currency);
    if (next !== choices.provider) setProvider(next);
  }, [ready, choices.provider, currency, setProvider]);

  const vendorIds = vendorIdsOf(lines);
  const shippingComplete =
    shippingOptions !== null &&
    vendorIds.every((v) => {
      const chosen = choices.shipping[v];
      return methodsForVendor(shippingOptions, v, currency).some((m) => m.id === chosen);
    });
  const canContinue = shippingComplete && choices.provider !== null;

  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('steps.shipping')}
      </h1>
      <StepTabs current="shipping" className="mt-6" />
      {!ready ? (
        <p role="status" className="mt-8 text-body-m text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
          <div className="flex flex-col gap-5">
            <CheckoutNotice />
            <Card className="flex flex-col gap-4 p-5 lg:p-6">
              <h2 className="font-heading text-h5 font-semibold text-text-primary">
                {t('checkout.chooseShipping')}
              </h2>
              <ShippingPicker lines={lines} options={shippingOptions} failed={shippingFailed} />
            </Card>

            <Card className="flex flex-col gap-4 p-5 lg:p-6">
              <h2 className="font-heading text-h5 font-semibold text-text-primary">
                {t('checkout.paymentWith')}
              </h2>
              <PaymentForm currency={currency} value={choices.provider} onChange={setProvider} />
            </Card>

            <div className="flex flex-wrap justify-between gap-3">
              <ButtonLink href="/checkout/info" variant="outline" size="lg">
                <ArrowLeft className="size-4" />
                {t('common.back')}
              </ButtonLink>
              {canContinue ? (
                <ButtonLink href="/checkout/review" size="lg">
                  {t('common.continue')}
                  <ArrowRight className="size-4" />
                </ButtonLink>
              ) : (
                <Button size="lg" disabled>
                  {t('common.continue')}
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <OrderSummary lines={payableLines(lines)} totals={totals} showItems estimate />
          </div>
        </div>
      )}
    </Container>
  );
}
