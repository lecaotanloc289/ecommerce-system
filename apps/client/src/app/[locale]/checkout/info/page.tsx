'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button, Card } from '@repo/ui';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { StepTabs } from '@/components/checkout/step-tabs';
import { AddressPicker } from '@/components/checkout/address-picker';
import { CheckoutNotice } from '@/components/checkout/checkout-notice';
import { OrderSummary } from '@/components/checkout/order-summary';
import { useCheckoutGuard } from '@/components/checkout/use-checkout-guard';
import { useT } from '@/i18n/use-locale';
import { payableLines } from '@/lib/cart';
import { useCheckout, useOrderTotals } from '@/store/checkout-store';

export default function CheckoutInfoPage() {
  const t = useT();
  const { ready } = useCheckoutGuard('info');
  const { lines, totals } = useOrderTotals();
  const { choices } = useCheckout();

  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('cart.title')}
      </h1>
      <StepTabs current="info" className="mt-6" />
      {!ready ? (
        <p role="status" className="mt-8 text-body-m text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
          <div className="flex flex-col gap-5">
            <CheckoutNotice />
            <Card className="flex flex-col gap-5 p-5 lg:p-6">
              <h2 className="font-heading text-h5 font-semibold text-text-primary">
                {t('checkout.savedAddresses')}
              </h2>
              <AddressPicker />
            </Card>

            <div className="flex flex-wrap justify-between gap-3">
              <ButtonLink href="/cart" variant="outline" size="lg">
                <ArrowLeft className="size-4" />
                {t('common.back')}
              </ButtonLink>
              {choices.addressId ? (
                <ButtonLink href="/checkout/shipping" size="lg">
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
