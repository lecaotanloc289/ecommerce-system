'use client';

import * as React from 'react';
import type { AppLocale } from '@repo/i18n';
import { cartItemCount, type CartItemSnapshot, type CartLineView } from '../lib/cart';
import {
  EMPTY_CART,
  addBlocker,
  addItem,
  applyRefresh,
  cartViews,
  removeItem,
  sanitizeCart,
  setItemQuantity,
  type AddToCartResult,
  type GuestCart,
  type ProductRefresh,
} from '../lib/guest-cart';
import { fetchProduct } from '../lib/api/browser';
import { readStored, removeStored, writeStored } from './persisted';

export type { AddToCartResult } from '../lib/guest-cart';

/**
 * Guest cart provider (storefront CLAUDE.md §6). State logic is pure (`lib/guest-cart.ts`);
 * this persists it to localStorage (`guest-cart.v2`), syncs tabs and refreshes snapshots
 * from the catalog API. T5.1 merges it into the server cart on sign-in.
 */
const STORAGE_KEY = 'guest-cart.v2';
/** Pre-API format (mock product ids) — dropped on first load. */
const LEGACY_STORAGE_KEY = 'guest-cart';

interface CartContextValue {
  /** False until localStorage has been read — render no cart-dependent UI before that. */
  hydrated: boolean;
  lines: CartLineView[];
  itemCount: number;
  add: (item: CartItemSnapshot, quantity: number) => AddToCartResult;
  setQty: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  /** Re-read every product in the cart (current price/stock/name in `locale`); drops gone items. */
  refresh: (locale: AppLocale) => Promise<void>;
}

const CartContext = React.createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Empty until hydrated, so the prerendered HTML never shows a stale cart.
  const [cart, setCart] = React.useState<GuestCart>(EMPTY_CART);
  const [hydrated, setHydrated] = React.useState(false);
  // Latest committed cart, for synchronous checks in callbacks (updaters run later).
  const cartRef = React.useRef(cart);
  cartRef.current = cart;

  React.useEffect(() => {
    removeStored('local', LEGACY_STORAGE_KEY);
    setCart(sanitizeCart(readStored('local', STORAGE_KEY)));
    setHydrated(true);
    // Keep tabs in sync: another tab's write replaces this tab's state.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setCart(sanitizeCart(readStored('local', STORAGE_KEY)));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  React.useEffect(() => {
    if (hydrated) writeStored('local', STORAGE_KEY, cart);
  }, [hydrated, cart]);

  const add = React.useCallback((item: CartItemSnapshot, quantity: number): AddToCartResult => {
    const blocker = addBlocker(cartRef.current, item);
    if (blocker) return blocker;
    setCart((prev) => addItem(prev, item, quantity));
    return 'added';
  }, []);

  const setQty = React.useCallback((variantId: string, quantity: number) => {
    setCart((prev) => setItemQuantity(prev, variantId, quantity));
  }, []);

  const remove = React.useCallback((variantId: string) => {
    setCart((prev) => removeItem(prev, variantId));
  }, []);

  const clear = React.useCallback(() => setCart(EMPTY_CART), []);

  const refresh = React.useCallback(async (locale: AppLocale) => {
    const slugs = [...new Set(cartRef.current.items.map((i) => i.productSlug))];
    if (slugs.length === 0) return;
    const results = await Promise.all(
      slugs.map((slug) =>
        fetchProduct(slug, locale).then(
          (product): ProductRefresh => ({ slug, ok: true, product }),
          (): ProductRefresh => ({ slug, ok: false }),
        ),
      ),
    );
    setCart((prev) => applyRefresh(prev, results));
  }, []);

  const value = React.useMemo<CartContextValue>(() => {
    const lines = cartViews(cart);
    return {
      hydrated,
      lines,
      itemCount: cartItemCount(lines),
      add,
      setQty,
      remove,
      clear,
      refresh,
    };
  }, [hydrated, cart, add, setQty, remove, clear, refresh]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
