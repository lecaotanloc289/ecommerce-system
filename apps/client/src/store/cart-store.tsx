'use client';

import * as React from 'react';
import { useLocale as useRouteLocale } from 'next-intl';
import { toast } from '@repo/ui';
import { createTranslator, type AppLocale } from '@repo/i18n';
import type { Cart } from '@repo/core';
import {
  cartItemCount,
  maxQtyFor,
  mixesCurrency,
  payableLines,
  type CartItemSnapshot,
  type CartLineView,
} from '../lib/cart';
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
import { createCartMerger, summarizeAdjustments, type PendingMerge } from '../lib/cart-merge';
import { cartToViews } from '../lib/server-cart';
import { fetchProduct } from '../lib/api/browser';
import { deleteCartItem, fetchCart, mergeCart, putCartItem } from '../lib/api/commerce';
import { describeError } from '../lib/api/error-message';
import { useAuth } from './auth-provider';
import { readStored, removeStored, writeStored } from './persisted';

export type { AddToCartResult } from '../lib/guest-cart';

/**
 * Cart provider (storefront CLAUDE.md "Cart"). One interface, two sources:
 * - **guest** (anonymous): pure state in `lib/guest-cart.ts`, persisted in localStorage
 *   (`guest-cart.v2`), synced across tabs, refreshed from the catalog API;
 * - **server** (signed in): the API cart (`GET/PUT/DELETE /v1/cart…`) is the source of truth.
 *   On the transition to authenticated the guest lines are merged ONCE (`POST /v1/cart/merge`,
 *   fixed idempotency key kept until it succeeds), the guest cart is cleared and the
 *   adjustments are shown as a toast.
 */
const STORAGE_KEY = 'guest-cart.v2';
/** Pre-API format (mock product ids) — dropped on first load. */
const LEGACY_STORAGE_KEY = 'guest-cart';
/** sessionStorage: the pending merge's idempotency key (never a token). */
const MERGE_STORAGE_KEY = 'cart-merge';

interface CartContextValue {
  /** False until the cart source is known and loaded — render no cart-dependent UI before that. */
  hydrated: boolean;
  source: 'guest' | 'server';
  lines: CartLineView[];
  /** Sum of quantities of the available lines (the header badge). */
  itemCount: number;
  /** Available lines span several currencies — checkout is blocked (roadmap D6). */
  hasMixedCurrency: boolean;
  /** A server mutation is in flight. */
  busy: boolean;
  /** The last failed server call (translate with `describeError`); null when none. */
  error: unknown;
  dismissError: () => void;
  add: (item: CartItemSnapshot, quantity: number) => Promise<AddToCartResult>;
  setQty: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  /** Re-read the cart: server cart, or every product of the guest cart (current price/stock/name). */
  refresh: (locale: AppLocale) => Promise<void>;
}

const CartContext = React.createContext<CartContextValue | null>(null);

function readPendingMerge(): PendingMerge | null {
  const stored = readStored('session', MERGE_STORAGE_KEY);
  if (typeof stored !== 'object' || stored === null) return null;
  const key = 'key' in stored ? stored.key : undefined;
  const fingerprint = 'fingerprint' in stored ? stored.fingerprint : undefined;
  return typeof key === 'string' && typeof fingerprint === 'string' ? { key, fingerprint } : null;
}

function hasMixedCurrencyLines(lines: readonly CartLineView[]): boolean {
  const payable = payableLines(lines);
  const first = payable[0];
  return first ? payable.some((l) => mixesCurrency([first], l)) : false;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const routeLocale = useRouteLocale();
  const { status, user } = useAuth();
  const userId = user?.id ?? null;
  const authenticated = status === 'authenticated';

  // Guest cart: empty until hydrated, so the prerendered HTML never shows a stale cart.
  const [guest, setGuest] = React.useState<GuestCart>(EMPTY_CART);
  const [guestHydrated, setGuestHydrated] = React.useState(false);
  const guestRef = React.useRef(guest);
  guestRef.current = guest;

  // Server cart (signed in).
  const [serverCart, setServerCart] = React.useState<Cart | null>(null);
  const [serverLoaded, setServerLoaded] = React.useState(false);
  const [busyCount, setBusyCount] = React.useState(0);
  const [error, setError] = React.useState<unknown>(null);
  const serverCartRef = React.useRef(serverCart);
  serverCartRef.current = serverCart;
  const localeRef = React.useRef(routeLocale);
  localeRef.current = routeLocale;

  const merger = React.useMemo(
    () =>
      createCartMerger({
        post: (items, key) => mergeCart(items, localeRef.current, key),
        keys: {
          get: readPendingMerge,
          set: (pending) =>
            pending
              ? writeStored('session', MERGE_STORAGE_KEY, pending)
              : removeStored('session', MERGE_STORAGE_KEY),
        },
      }),
    [],
  );

  React.useEffect(() => {
    removeStored('local', LEGACY_STORAGE_KEY);
    setGuest(sanitizeCart(readStored('local', STORAGE_KEY)));
    setGuestHydrated(true);
    // Keep tabs in sync: another tab's write replaces this tab's state.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setGuest(sanitizeCart(readStored('local', STORAGE_KEY)));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  React.useEffect(() => {
    if (guestHydrated) writeStored('local', STORAGE_KEY, guest);
  }, [guestHydrated, guest]);

  // Signed in: merge the guest cart once, then load the server cart. Signed out: drop it.
  React.useEffect(() => {
    if (!guestHydrated) return;
    if (!authenticated) {
      if (status === 'anonymous') {
        setServerCart(null);
        setServerLoaded(false);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    const t = createTranslator(localeRef.current);
    void (async () => {
      let cart: Cart | null = null;
      try {
        const merged = await merger.merge(guestRef.current.lines);
        if (merged) {
          cart = merged.cart;
          setGuest(EMPTY_CART);
          const { clamped, unavailable } = summarizeAdjustments(merged.adjustments);
          if (!cancelled && (clamped > 0 || unavailable > 0)) {
            toast.warning(t('cart.merge.adjustedTitle'), {
              description: [
                clamped > 0 ? t('cart.merge.clamped', { count: clamped }) : '',
                unavailable > 0 ? t('cart.merge.unavailable', { count: unavailable }) : '',
              ]
                .filter(Boolean)
                .join(' '),
            });
          }
        }
      } catch (e) {
        // Guest lines stay in storage; the pending key makes the next attempt a safe replay.
        if (!cancelled) {
          toast.error(t('cart.merge.failed'), {
            description: describeError(localeRef.current, e),
          });
        }
      }
      try {
        cart ??= await fetchCart(localeRef.current);
        if (!cancelled) setServerCart(cart);
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setServerLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestHydrated, authenticated, status, userId, merger]);

  // The API resolves product names / slugs in the requested locale.
  const loadedLocaleRef = React.useRef(routeLocale);
  React.useEffect(() => {
    if (loadedLocaleRef.current === routeLocale) return;
    loadedLocaleRef.current = routeLocale;
    if (!authenticated || !serverLoaded) return;
    void fetchCart(routeLocale).then(setServerCart, setError);
  }, [routeLocale, authenticated, serverLoaded]);

  // Server mutations run one at a time, so rapid +/- clicks can't reorder.
  const queueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = React.useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    setBusyCount((n) => n + 1);
    const run = queueRef.current.then(task, task);
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => setBusyCount((n) => n - 1));
  }, []);

  /** Run a server mutation: apply the returned cart, or surface the error and resync. */
  const mutate = React.useCallback(
    async (call: () => Promise<Cart>): Promise<void> => {
      try {
        setServerCart(await enqueue(call));
        setError(null);
      } catch (e) {
        setError(e);
        void fetchCart(localeRef.current).then(setServerCart, () => undefined);
      }
    },
    [enqueue],
  );

  const serverMode = authenticated;

  const add = React.useCallback(
    async (item: CartItemSnapshot, quantity: number): Promise<AddToCartResult> => {
      if (!serverMode) {
        const blocker = addBlocker(guestRef.current, item);
        if (blocker) return blocker;
        setGuest((prev) => addItem(prev, item, quantity));
        return 'added';
      }
      const existing = serverCartRef.current ? cartToViews(serverCartRef.current) : [];
      if (maxQtyFor(item.stockAvailable) < 1) return 'out-of-stock';
      if (mixesCurrency(payableLines(existing), item)) return 'currency-mismatch';
      const current = existing.find((l) => l.variantId === item.variantId)?.quantity ?? 0;
      const next = Math.min(current + Math.max(1, quantity), maxQtyFor(item.stockAvailable));
      // Throws ApiError: the caller shows the translated message.
      const cart = await enqueue(() => putCartItem(item.variantId, next, localeRef.current));
      setServerCart(cart);
      return 'added';
    },
    [serverMode, enqueue],
  );

  const setQty = React.useCallback(
    async (variantId: string, quantity: number): Promise<void> => {
      if (!serverMode) {
        setGuest((prev) => setItemQuantity(prev, variantId, quantity));
        return;
      }
      await mutate(() => putCartItem(variantId, quantity, localeRef.current));
    },
    [serverMode, mutate],
  );

  const remove = React.useCallback(
    async (variantId: string): Promise<void> => {
      if (!serverMode) {
        setGuest((prev) => removeItem(prev, variantId));
        return;
      }
      await mutate(() => deleteCartItem(variantId, localeRef.current));
    },
    [serverMode, mutate],
  );

  const refresh = React.useCallback(
    async (locale: AppLocale) => {
      if (serverMode) {
        await mutate(() => fetchCart(locale));
        return;
      }
      const slugs = [...new Set(guestRef.current.items.map((i) => i.productSlug))];
      if (slugs.length === 0) return;
      const results = await Promise.all(
        slugs.map((slug) =>
          fetchProduct(slug, locale).then(
            (product): ProductRefresh => ({ slug, ok: true, product }),
            (): ProductRefresh => ({ slug, ok: false }),
          ),
        ),
      );
      setGuest((prev) => applyRefresh(prev, results));
    },
    [serverMode, mutate],
  );

  const dismissError = React.useCallback(() => setError(null), []);

  const value = React.useMemo<CartContextValue>(() => {
    const lines = serverMode ? (serverCart ? cartToViews(serverCart) : []) : cartViews(guest);
    // While the session is still being restored the cart source is unknown.
    const hydrated = guestHydrated && status !== 'loading' && (!serverMode || serverLoaded);
    return {
      hydrated,
      source: serverMode ? 'server' : 'guest',
      lines,
      itemCount: cartItemCount(payableLines(lines)),
      hasMixedCurrency:
        serverMode && serverCart ? serverCart.hasMixedCurrency : hasMixedCurrencyLines(lines),
      busy: busyCount > 0,
      error,
      dismissError,
      add,
      setQty,
      remove,
      refresh,
    };
  }, [
    serverMode,
    serverCart,
    serverLoaded,
    guest,
    guestHydrated,
    status,
    busyCount,
    error,
    dismissError,
    add,
    setQty,
    remove,
    refresh,
  ]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
