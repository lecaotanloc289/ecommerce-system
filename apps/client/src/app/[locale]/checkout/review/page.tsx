'use client';

import * as React from 'react';
import type { ReactNode } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { ArrowLeft, CreditCard, MapPin, Pencil } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle, Button, Card } from '@repo/ui';
import type { Address } from '@repo/core';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { AddressLines } from '@/components/address/address-lines';
import { StepTabs } from '@/components/checkout/step-tabs';
import { CouponInput } from '@/components/checkout/coupon-input';
import { OrderSummary } from '@/components/checkout/order-summary';
import { useCheckoutGuard } from '@/components/checkout/use-checkout-guard';
import { usePaymentFlow } from '@/components/checkout/use-payment-flow';
import { ProductImage } from '@/components/product/product-image';
import { useLocale } from '@/i18n/use-locale';
import { formatMoney } from '@repo/i18n';
import { placeOrder } from '@/lib/api/commerce';
import { listAddresses } from '@/lib/api/account';
import { ApiError } from '@/lib/api/errors';
import { describeError, errorCodeOfThrown } from '@/lib/api/error-message';
import { attributesLabel, lineTotal, payableLines } from '@/lib/cart';
import {
  buildCheckoutBody,
  cartCurrency,
  checkoutFingerprint,
  methodsForVendor,
  vendorIdsOf,
} from '@/lib/checkout';
import { STEP_PATH, stepForError } from '@/lib/checkout-errors';
import { newIdempotencyKey as newUlid } from '@/lib/idempotency';
import { useCart } from '@/store/cart-store';
import { useCheckout, useOrderTotals } from '@/store/checkout-store';

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
  const router = useRouter();
  const { refresh } = useCart();
  const { choices, reset, setNotice } = useCheckout();
  const [placedOrderId, setPlacedOrderId] = React.useState<string | null>(null);
  // The guard stops once the order exists: the cart and the choices are consumed by then.
  const { ready, shippingOptions } = useCheckoutGuard('review', {
    enabled: placedOrderId === null,
  });
  const { lines, totals } = useOrderTotals(shippingOptions);
  const flow = usePaymentFlow();
  const [placing, setPlacing] = React.useState(false);
  const [error, setError] = React.useState<{
    text: string;
    step: keyof typeof STEP_PATH | null;
  } | null>(null);
  const [address, setAddress] = React.useState<Address | null>(null);

  // One Idempotency-Key per place-order attempt: created when the review step mounts and kept
  // for double-clicks / retries; replaced only if the request body changes (else the API would
  // answer `idempotency.error.key-reused`).
  const keyRef = React.useRef<{ fingerprint: string | null; key: string }>({
    fingerprint: null,
    key: newUlid(),
  });

  React.useEffect(() => {
    if (!ready || !choices.addressId) return;
    let cancelled = false;
    void listAddresses().then(
      (list) => {
        if (!cancelled) setAddress(list.find((a) => a.id === choices.addressId) ?? null);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ready, choices.addressId]);

  const payable = payableLines(lines);
  const currency = cartCurrency(lines);
  const body = buildCheckoutBody(lines, choices);

  const onPlace = async () => {
    if (!body || placing) return;
    const fingerprint = checkoutFingerprint(body);
    const current = keyRef.current;
    if (current.fingerprint !== null && current.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: newUlid() };
    } else {
      keyRef.current = { fingerprint, key: current.key };
    }
    setPlacing(true);
    setError(null);
    try {
      const order = await placeOrder(body, keyRef.current.key);
      setPlacedOrderId(order.id);
      reset();
      void refresh(locale);
      void flow.follow(order.id);
    } catch (e) {
      const code = errorCodeOfThrown(e);
      const step = stepForError(code);
      if (step && step !== 'review' && code) {
        setNotice({
          errorCode: code,
          ...(e instanceof ApiError && e.params ? { params: e.params } : {}),
        });
        router.push(STEP_PATH[step]);
      } else {
        setError({ text: describeError(locale, e), step });
      }
    } finally {
      setPlacing(false);
    }
  };

  const vendors = vendorIdsOf(lines);
  const providerLabel =
    choices.provider === 'VNPAY'
      ? t('payment.vnpay')
      : choices.provider === 'STRIPE'
        ? t('payment.stripe')
        : '';

  if (placedOrderId) {
    return (
      <Container as="section" className="flex flex-col items-center gap-4 py-16 text-center">
        {flow.state.phase === 'timeout' || flow.state.phase === 'failed' ? (
          <>
            <h1 className="font-heading text-h4 font-bold text-text-primary">
              {flow.state.phase === 'timeout'
                ? t('checkout.paymentTimeout')
                : t('checkout.paymentFailed')}
            </h1>
            <p className="max-w-md text-body-m text-text-muted">
              {flow.state.phase === 'failed' && flow.state.error
                ? describeError(locale, flow.state.error)
                : t('checkout.paymentTimeoutHint')}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                onClick={() =>
                  void (flow.state.phase === 'failed'
                    ? flow.pay(placedOrderId)
                    : flow.follow(placedOrderId))
                }
              >
                {t('checkout.retryPayment')}
              </Button>
              <ButtonLink href={`/account/orders/${placedOrderId}`} variant="outline">
                {t('checkout.viewOrder')}
              </ButtonLink>
            </div>
          </>
        ) : (
          <p role="status" className="text-body-l text-text-primary">
            {flow.state.phase === 'redirecting'
              ? t('checkout.redirecting')
              : t('checkout.waitingPayment')}
          </p>
        )}
      </Container>
    );
  }

  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {t('steps.review')}
      </h1>
      <StepTabs current="review" className="mt-6" />

      {!ready ? (
        <p role="status" className="mt-8 text-body-m text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_350px]">
          <div className="flex flex-col gap-5">
            {error ? (
              <Alert variant="danger">
                <AlertTitle>{t('common.errorTitle')}</AlertTitle>
                <AlertDescription>
                  {error.text}
                  {error.step && error.step !== 'review' ? (
                    <>
                      {' '}
                      <Link href={STEP_PATH[error.step]} className="font-medium underline">
                        {t('checkout.goToStep', { step: t(`steps.${error.step}`) })}
                      </Link>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <ReviewCard
                icon={<MapPin className="size-5" />}
                title={t('checkout.shippingTo')}
                editHref="/checkout/info"
              >
                {address ? <AddressLines address={address} /> : null}
                <ul className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3 text-body-s">
                  {vendors.map((vendorId) => {
                    const method = methodsForVendor(shippingOptions, vendorId, currency).find(
                      (m) => m.id === choices.shipping[vendorId],
                    );
                    const vendorName =
                      payable.find((l) => l.vendorId === vendorId)?.vendorName ?? '';
                    return (
                      <li key={vendorId} className="flex items-center justify-between gap-2">
                        <span className="text-text-muted">
                          {vendorName}:{' '}
                          <span className="font-medium text-text-primary">{method?.name}</span>
                        </span>
                        {method && method.price.amount > 0 ? (
                          <span className="font-semibold text-text-price">
                            {formatMoney(method.price, locale)}
                          </span>
                        ) : (
                          <span className="text-success-fg">{t('summary.free')}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </ReviewCard>
              <ReviewCard
                icon={<CreditCard className="size-5" />}
                title={t('checkout.paymentMethod')}
                editHref="/checkout/shipping"
              >
                <p className="text-body-m font-medium text-text-primary">{providerLabel}</p>
                <p className="text-body-s text-text-muted">{t('payment.hostedNote')}</p>
              </ReviewCard>
            </div>

            <div>
              <h2 className="mb-3 font-heading text-h5 font-semibold text-text-primary">
                {t('checkout.itemsInCart')}
              </h2>
              <Card className="divide-y divide-border-faint p-0">
                {payable.map((line) => (
                  <div key={line.variantId} className="flex items-center gap-4 p-4">
                    <ProductImage
                      src={line.imageUrl}
                      alt={line.productName}
                      className="size-16 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-body-m font-medium text-text-primary">
                        {line.productName}
                      </p>
                      <p className="text-body-s text-text-muted">
                        {[attributesLabel(line.attributes), line.vendorName]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <span className="text-body-s text-text-muted">×{line.quantity}</span>
                    <span className="text-body-m font-semibold text-text-price">
                      {formatMoney(lineTotal(line), locale)}
                    </span>
                  </div>
                ))}
              </Card>
            </div>

            <CouponInput />

            <ButtonLink href="/checkout/shipping" variant="outline" size="lg" className="w-fit">
              <ArrowLeft className="size-4" />
              {t('common.back')}
            </ButtonLink>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <OrderSummary
              lines={payable}
              totals={totals}
              showItems
              estimate
              footer={
                <Button
                  size="lg"
                  fullWidth
                  disabled={!body || placing}
                  aria-busy={placing}
                  onClick={() => void onPlace()}
                >
                  {placing ? t('checkout.placing') : t('checkout.placeOrder')}
                </Button>
              }
            />
          </div>
        </div>
      )}
    </Container>
  );
}
