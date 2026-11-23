'use client';

import * as React from 'react';
import { CouponCodeSchema, type CartShippingOptions, type PaymentProvider } from '@repo/core';
import {
  EMPTY_CHOICES,
  cartCurrency,
  chosenShippingFees,
  sanitizeChoices,
  vendorIdsOf,
  type CheckoutChoices,
} from '../lib/checkout';
import { computeTotals, type CartLineView, type OrderTotals } from '../lib/cart';
import { platformSettings } from '../mocks/platform-settings';
import { useCart } from './cart-store';
import { readStored, writeStored } from './persisted';

/**
 * Checkout choices shared by the cart and every checkout step (address, shipping method per
 * vendor, payment provider, coupon codes). Ids and codes only, persisted to sessionStorage so
 * they survive navigating between steps (and reloads) in a tab. The server re-validates all of it.
 */
const STORAGE_KEY = 'checkout.v2';

/** Why the customer was sent back to a step (an API error to show there). */
export interface CheckoutNotice {
  errorCode: string;
  params?: Record<string, string | number | boolean>;
}

interface CheckoutContextValue {
  hydrated: boolean;
  choices: CheckoutChoices;
  setAddressId: (id: string | null) => void;
  /** Replace the vendor → shipping method map (e.g. after loading the options). */
  setShipping: (shipping: Record<string, string>) => void;
  setShippingFor: (vendorId: string, methodId: string) => void;
  setProvider: (provider: PaymentProvider | null) => void;
  /** Adds a coupon code; 'invalid' = malformed, 'duplicate' = already in the list. */
  addCouponCode: (code: string) => 'added' | 'invalid' | 'duplicate';
  removeCouponCode: (code: string) => void;
  /** Back to defaults — called once an order is placed. */
  reset: () => void;
  notice: CheckoutNotice | null;
  setNotice: (notice: CheckoutNotice | null) => void;
}

const CheckoutContext = React.createContext<CheckoutContextValue | null>(null);

export function CheckoutProvider({ children }: { children: React.ReactNode }) {
  const [choices, setChoices] = React.useState<CheckoutChoices>(EMPTY_CHOICES);
  const [hydrated, setHydrated] = React.useState(false);
  const [notice, setNotice] = React.useState<CheckoutNotice | null>(null);

  React.useEffect(() => {
    setChoices(sanitizeChoices(readStored('session', STORAGE_KEY)));
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (hydrated) writeStored('session', STORAGE_KEY, choices);
  }, [hydrated, choices]);

  const setAddressId = React.useCallback(
    (addressId: string | null) => setChoices((c) => ({ ...c, addressId })),
    [],
  );
  const setShipping = React.useCallback(
    (shipping: Record<string, string>) => setChoices((c) => ({ ...c, shipping })),
    [],
  );
  const setShippingFor = React.useCallback(
    (vendorId: string, methodId: string) =>
      setChoices((c) => ({ ...c, shipping: { ...c.shipping, [vendorId]: methodId } })),
    [],
  );
  const setProvider = React.useCallback(
    (provider: PaymentProvider | null) => setChoices((c) => ({ ...c, provider })),
    [],
  );
  const choicesRef = React.useRef(choices);
  choicesRef.current = choices;
  const addCouponCode = React.useCallback((raw: string): 'added' | 'invalid' | 'duplicate' => {
    const parsed = CouponCodeSchema.safeParse(raw);
    if (!parsed.success) return 'invalid';
    if (choicesRef.current.couponCodes.includes(parsed.data)) return 'duplicate';
    setChoices((c) => ({ ...c, couponCodes: [...c.couponCodes, parsed.data] }));
    return 'added';
  }, []);
  const removeCouponCode = React.useCallback(
    (code: string) =>
      setChoices((c) => ({ ...c, couponCodes: c.couponCodes.filter((x) => x !== code) })),
    [],
  );
  const reset = React.useCallback(() => setChoices(EMPTY_CHOICES), []);

  const value = React.useMemo<CheckoutContextValue>(
    () => ({
      hydrated,
      choices,
      setAddressId,
      setShipping,
      setShippingFor,
      setProvider,
      addCouponCode,
      removeCouponCode,
      reset,
      notice,
      setNotice,
    }),
    [
      hydrated,
      choices,
      setAddressId,
      setShipping,
      setShippingFor,
      setProvider,
      addCouponCode,
      removeCouponCode,
      reset,
      notice,
    ],
  );

  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}

export function useCheckout(): CheckoutContextValue {
  const ctx = React.useContext(CheckoutContext);
  if (!ctx) throw new Error('useCheckout must be used within <CheckoutProvider>');
  return ctx;
}

/**
 * Cart lines + checkout choices → an ESTIMATE of the totals (subtotal of available lines + the
 * chosen shipping fees; coupons and rounding are the server's). Every summary reads this until
 * the order is placed.
 */
export function useOrderTotals(shippingOptions: CartShippingOptions | null = null): {
  hydrated: boolean;
  lines: CartLineView[];
  hasMixedCurrency: boolean;
  totals: OrderTotals;
} {
  const { hydrated, lines, hasMixedCurrency } = useCart();
  const { choices } = useCheckout();
  return React.useMemo(() => {
    const currency = cartCurrency(lines);
    const fees = chosenShippingFees(choices, vendorIdsOf(lines), shippingOptions, currency);
    return {
      hydrated,
      lines,
      hasMixedCurrency,
      totals: computeTotals(lines, fees, platformSettings.defaultCurrency),
    };
  }, [hydrated, lines, hasMixedCurrency, choices, shippingOptions]);
}
