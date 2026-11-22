'use client';

import * as React from 'react';
import type { CartLine, ShippingMethod, Voucher } from '../types';
import { computeTotals, type OrderTotals } from '../lib/cart';
import { findShippingMethod, findVoucher, shippingMethods } from '../mocks/cart';
import { platformSettings } from '../mocks/platform-settings';
import { useCart } from './cart-store';
import { readStored, writeStored } from './persisted';

/**
 * Checkout choices shared by the cart and every checkout step. Persisted to
 * sessionStorage so they survive navigating between steps (and reloads) in a tab.
 */
const STORAGE_KEY = 'checkout';

interface CheckoutState {
  shippingMethodId: string | null;
  voucherCode: string | null;
  /** "Notify me on Zalo" — sent as `Checkout.zaloOptIn`; shops only message opted-in orders. */
  zaloOptIn: boolean;
}

interface CheckoutContextValue extends CheckoutState {
  setShippingMethodId: (id: string) => void;
  setVoucherCode: (code: string | null) => void;
  setZaloOptIn: (optIn: boolean) => void;
  /** Back to defaults — called once an order is placed. */
  reset: () => void;
}

const DEFAULT_STATE: CheckoutState = {
  shippingMethodId: shippingMethods[0]?.id ?? null,
  voucherCode: null,
  zaloOptIn: false,
};

const CheckoutContext = React.createContext<CheckoutContextValue | null>(null);

function sanitize(stored: unknown): CheckoutState | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const shippingMethodId =
    'shippingMethodId' in stored && typeof stored.shippingMethodId === 'string'
      ? stored.shippingMethodId
      : null;
  const voucherCode =
    'voucherCode' in stored && typeof stored.voucherCode === 'string' ? stored.voucherCode : null;
  return {
    shippingMethodId: findShippingMethod(shippingMethodId)
      ? shippingMethodId
      : DEFAULT_STATE.shippingMethodId,
    voucherCode: findVoucher(voucherCode) ? voucherCode : null,
    zaloOptIn: 'zaloOptIn' in stored && stored.zaloOptIn === true,
  };
}

export function CheckoutProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<CheckoutState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const saved = sanitize(readStored('session', STORAGE_KEY));
    if (saved) setState(saved);
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (hydrated) writeStored('session', STORAGE_KEY, state);
  }, [hydrated, state]);

  const setShippingMethodId = React.useCallback((id: string) => {
    if (findShippingMethod(id)) setState((s) => ({ ...s, shippingMethodId: id }));
  }, []);

  const setVoucherCode = React.useCallback((code: string | null) => {
    setState((s) => ({ ...s, voucherCode: findVoucher(code)?.code ?? null }));
  }, []);

  const setZaloOptIn = React.useCallback((optIn: boolean) => {
    setState((s) => ({ ...s, zaloOptIn: optIn }));
  }, []);

  const reset = React.useCallback(() => setState(DEFAULT_STATE), []);

  const value = React.useMemo<CheckoutContextValue>(
    () => ({ ...state, setShippingMethodId, setVoucherCode, setZaloOptIn, reset }),
    [state, setShippingMethodId, setVoucherCode, setZaloOptIn, reset],
  );

  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}

export function useCheckout(): CheckoutContextValue {
  const ctx = React.useContext(CheckoutContext);
  if (!ctx) throw new Error('useCheckout must be used within <CheckoutProvider>');
  return ctx;
}

/** Cart lines + checkout choices → totals. Every summary on cart/checkout reads this. */
export function useOrderTotals(): {
  hydrated: boolean;
  lines: CartLine[];
  totals: OrderTotals;
  shippingMethod: ShippingMethod | undefined;
  voucher: Voucher | undefined;
} {
  const { hydrated, lines } = useCart();
  const { shippingMethodId, voucherCode } = useCheckout();
  return React.useMemo(() => {
    const shippingMethod = findShippingMethod(shippingMethodId);
    const voucher = findVoucher(voucherCode);
    return {
      hydrated,
      lines,
      shippingMethod,
      voucher,
      totals: computeTotals(lines, shippingMethod, voucher, platformSettings.defaultCurrency),
    };
  }, [hydrated, lines, shippingMethodId, voucherCode]);
}
