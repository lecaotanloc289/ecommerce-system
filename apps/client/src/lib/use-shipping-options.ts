'use client';

import * as React from 'react';
import type { CartShippingOptions } from '@repo/core';
import { fetchShippingOptions } from './api/commerce';

/**
 * `GET /v1/cart/shipping-options` for the signed-in cart. Reloads when the set of vendors in
 * the cart changes (`signature`); `enabled` is false until the session and cart are ready.
 */
export function useShippingOptions(
  enabled: boolean,
  signature: string,
): { options: CartShippingOptions | null; failed: boolean } {
  const [options, setOptions] = React.useState<CartShippingOptions | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setFailed(false);
    fetchShippingOptions().then(
      (result) => {
        if (!cancelled) setOptions(result);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, signature]);

  return { options, failed };
}
