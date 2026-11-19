'use client';

import * as React from 'react';
import type { CartLine, GuestCartLine } from '../types';
import { cartItemCount, cartLineKey } from '../lib/cart';
import { canResolveCartLine, resolveCartLine, seedCartLines } from '../mocks/cart';
import { readStored, writeStored } from './persisted';

/**
 * Guest cart (storefront CLAUDE.md §6): lines `{ productId, variantId, qty }` kept in
 * localStorage. Seeded from mocks on first visit. Merges into the server `Cart` on
 * sign-in once the API exists.
 */
const STORAGE_KEY = 'guest-cart';

interface CartContextValue {
  /** False until localStorage has been read — render no cart-dependent UI before that. */
  hydrated: boolean;
  lines: CartLine[];
  itemCount: number;
  add: (productId: string, variantId: string | undefined, qty: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
}

const CartContext = React.createContext<CartContextValue | null>(null);

function isGuestCartLine(value: unknown): value is GuestCartLine {
  if (typeof value !== 'object' || value === null) return false;
  if (!('productId' in value) || typeof value.productId !== 'string') return false;
  if (!('qty' in value) || typeof value.qty !== 'number' || !Number.isInteger(value.qty)) {
    return false;
  }
  if (value.qty < 1) return false;
  return (
    !('variantId' in value) || value.variantId === undefined || typeof value.variantId === 'string'
  );
}

/** Max qty for a resolvable line; 0 means out of stock. */
function maxQtyOf(line: GuestCartLine): number {
  return resolveCartLine(line).maxQty;
}

/**
 * Stored data is untrusted: keep only well-formed, resolvable, in-stock lines,
 * merge duplicates by line key, and clamp qty to stock.
 */
function sanitize(stored: unknown): GuestCartLine[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const merged = new Map<string, GuestCartLine>();
  for (const line of stored.filter(isGuestCartLine).filter(canResolveCartLine)) {
    const key = cartLineKey(line.productId, line.variantId);
    const prevQty = merged.get(key)?.qty ?? 0;
    merged.set(key, {
      productId: line.productId,
      variantId: line.variantId,
      qty: prevQty + line.qty,
    });
  }
  return [...merged.values()]
    .map((l) => ({ ...l, qty: Math.min(l.qty, maxQtyOf(l)) }))
    .filter((l) => l.qty >= 1);
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Empty until hydrated, so returning visitors never see the seed cart flash.
  const [stored, setStored] = React.useState<GuestCartLine[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setStored(sanitize(readStored('local', STORAGE_KEY)) ?? seedCartLines);
    setHydrated(true);
    // Keep tabs in sync: another tab's write replaces this tab's state.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setStored(sanitize(readStored('local', STORAGE_KEY)) ?? []);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  React.useEffect(() => {
    if (hydrated) writeStored('local', STORAGE_KEY, stored);
  }, [hydrated, stored]);

  const add = React.useCallback((productId: string, variantId: string | undefined, qty: number) => {
    const line: GuestCartLine = { productId, variantId, qty };
    if (!canResolveCartLine(line)) return;
    const max = maxQtyOf(line);
    if (max < 1) return;
    setStored((prev) => {
      const key = cartLineKey(productId, variantId);
      const existing = prev.find((l) => cartLineKey(l.productId, l.variantId) === key);
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: Math.max(1, Math.min(max, l.qty + qty)) } : l,
        );
      }
      return [...prev, { ...line, qty: Math.max(1, Math.min(max, qty)) }];
    });
  }, []);

  const setQty = React.useCallback((key: string, qty: number) => {
    setStored((prev) =>
      prev.map((l) =>
        cartLineKey(l.productId, l.variantId) === key
          ? { ...l, qty: Math.max(1, Math.min(maxQtyOf(l), qty)) }
          : l,
      ),
    );
  }, []);

  const remove = React.useCallback((key: string) => {
    setStored((prev) => prev.filter((l) => cartLineKey(l.productId, l.variantId) !== key));
  }, []);

  const clear = React.useCallback(() => setStored([]), []);

  const value = React.useMemo<CartContextValue>(() => {
    const lines = stored.map(resolveCartLine);
    return { hydrated, lines, itemCount: cartItemCount(lines), add, setQty, remove, clear };
  }, [hydrated, stored, add, setQty, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = React.useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within <CartProvider>');
  return ctx;
}
