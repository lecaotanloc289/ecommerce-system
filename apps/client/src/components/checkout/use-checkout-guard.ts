'use client';

import * as React from 'react';
import { useRouter } from '@/i18n/navigation';
import type { CartShippingOptions } from '@repo/core';
import { checkoutGuard, type CheckoutStepName } from '../../lib/checkout';
import { STEP_PATH } from '../../lib/checkout-errors';
import { useShippingOptions } from '../../lib/use-shipping-options';
import { payableLines } from '../../lib/cart';
import { useAuth } from '../../store/auth-provider';
import { useCart } from '../../store/cart-store';
import { useCheckout } from '../../store/checkout-store';
import { useCurrentPath } from '../auth/require-auth';

/**
 * Step guard for the checkout pages: waits for the session, cart and saved choices, loads the
 * shipping options, and redirects to the step the customer must complete first (or to sign-in
 * with a `returnTo`). `ready` is true once the page may render its content.
 */
export function useCheckoutGuard(
  step: Exclude<CheckoutStepName, 'cart'>,
  { enabled = true }: { enabled?: boolean } = {},
): {
  ready: boolean;
  shippingOptions: CartShippingOptions | null;
  shippingFailed: boolean;
} {
  const router = useRouter();
  const { status } = useAuth();
  const { hydrated: cartHydrated, lines, hasMixedCurrency } = useCart();
  const { hydrated: choicesHydrated, choices } = useCheckout();
  const current = useCurrentPath();

  const signature = payableLines(lines)
    .map((l) => l.variantId)
    .join(',');
  const needsOptions = step !== 'info';
  const loaded = status === 'authenticated' && cartHydrated && lines.length > 0;
  const { options, failed } = useShippingOptions(needsOptions && loaded, signature);

  const settled = status !== 'loading' && cartHydrated && choicesHydrated;
  // The review guard needs the options to reject a stale pick; the shipping step loads them itself.
  const optionsPending = step === 'review' && loaded && !options && !failed;
  const target = settled
    ? checkoutGuard(step, {
        authenticated: status === 'authenticated',
        lines,
        hasMixedCurrency,
        choices,
        shippingOptions: step === 'review' ? options : null,
      })
    : null;

  React.useEffect(() => {
    if (!enabled || !settled || optionsPending || !target) return;
    if (target === 'sign-in') {
      router.replace(`/sign-in?${new URLSearchParams({ returnTo: current }).toString()}`);
    } else {
      router.replace(STEP_PATH[target]);
    }
  }, [enabled, settled, optionsPending, target, router, current]);

  return {
    ready: !enabled || (settled && !optionsPending && target === null),
    shippingOptions: options,
    shippingFailed: failed,
  };
}
