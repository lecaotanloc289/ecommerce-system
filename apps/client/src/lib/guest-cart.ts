import { CartLineInputSchema, type CartLineInput, type ProductDetail } from '@repo/core';
import {
  CartItemSnapshotSchema,
  maxQtyFor,
  toCartSnapshot,
  type CartItemSnapshot,
  type CartLineView,
} from './cart';

/**
 * Pure guest-cart state (storefront CLAUDE.md §6), persisted in localStorage by
 * `CartProvider`. `lines` is exactly the `CartLineInput[]` that `POST /v1/cart/merge` takes
 * (T5.1); `items` is per-variant display data captured from the catalog API.
 */
export interface GuestCart {
  lines: CartLineInput[];
  items: CartItemSnapshot[];
}

export const EMPTY_CART: GuestCart = { lines: [], items: [] };

export type AddToCartResult = 'added' | 'out-of-stock' | 'currency-mismatch';

type Quantities = ReadonlyMap<string, number>;
type Items = ReadonlyMap<string, CartItemSnapshot>;

const quantitiesOf = (cart: GuestCart) =>
  new Map<string, number>(cart.lines.map((l) => [l.variantId, l.quantity] as const));
const itemsOf = (cart: GuestCart) =>
  new Map<string, CartItemSnapshot>(cart.items.map((i) => [i.variantId, i] as const));

/** Keep lines that have a snapshot, clamp to stock, drop what can't be bought (qty < 1). */
function normalize(quantities: Quantities, items: Items): GuestCart {
  const lines: CartLineInput[] = [];
  const kept: CartItemSnapshot[] = [];
  for (const [variantId, quantity] of quantities) {
    const item = items.get(variantId);
    if (!item) continue;
    const clamped = Math.min(quantity, maxQtyFor(item.stockAvailable));
    if (clamped < 1) continue;
    lines.push({ variantId: item.variantId, quantity: clamped });
    kept.push(item);
  }
  return { lines, items: kept };
}

/**
 * Stored data is untrusted: keep well-formed lines (ULID variant id, integer quantity) that
 * have a valid snapshot, merge duplicates and clamp to stock. Anything else → empty cart.
 */
export function sanitizeCart(stored: unknown): GuestCart {
  if (typeof stored !== 'object' || stored === null) return EMPTY_CART;
  const rawLines = 'lines' in stored && Array.isArray(stored.lines) ? stored.lines : [];
  const rawItems = 'items' in stored && Array.isArray(stored.items) ? stored.items : [];
  const items = new Map<string, CartItemSnapshot>();
  for (const raw of rawItems) {
    const parsed = CartItemSnapshotSchema.safeParse(raw);
    if (parsed.success) items.set(parsed.data.variantId, parsed.data);
  }
  const quantities = new Map<string, number>();
  for (const raw of rawLines) {
    const parsed = CartLineInputSchema.safeParse(raw);
    if (!parsed.success || !items.has(parsed.data.variantId)) continue;
    const { variantId, quantity } = parsed.data;
    quantities.set(variantId, (quantities.get(variantId) ?? 0) + quantity);
  }
  return normalize(quantities, items);
}

/** Why `item` can't be added to `cart`, or null when it can. */
export function addBlocker(
  cart: GuestCart,
  item: CartItemSnapshot,
): Exclude<AddToCartResult, 'added'> | null {
  if (maxQtyFor(item.stockAvailable) < 1) return 'out-of-stock';
  // One order = one currency (roadmap D6): refuse to mix here rather than fail at checkout.
  if (cart.items.some((i) => i.unitPrice.currency !== item.unitPrice.currency)) {
    return 'currency-mismatch';
  }
  return null;
}

/** Add `quantity` of a variant (summed with an existing line, clamped to stock). */
export function addItem(cart: GuestCart, item: CartItemSnapshot, quantity: number): GuestCart {
  if (addBlocker(cart, item)) return cart;
  const quantities = quantitiesOf(cart);
  quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + Math.max(1, quantity));
  const items = itemsOf(cart);
  items.set(item.variantId, item);
  return normalize(quantities, items);
}

/** Set a line's quantity (at least 1, at most the stock). Unknown variant → unchanged. */
export function setItemQuantity(cart: GuestCart, variantId: string, quantity: number): GuestCart {
  const quantities = quantitiesOf(cart);
  if (!quantities.has(variantId)) return cart;
  quantities.set(variantId, Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1);
  return normalize(quantities, itemsOf(cart));
}

export function removeItem(cart: GuestCart, variantId: string): GuestCart {
  return {
    lines: cart.lines.filter((l) => l.variantId !== variantId),
    items: cart.items.filter((i) => i.variantId !== variantId),
  };
}

/**
 * Result of re-reading one product: `product` null = 404 (gone → its lines are dropped);
 * `ok: false` = the lookup failed (network/5xx) → keep the old snapshot.
 */
export type ProductRefresh =
  | { slug: string; ok: true; product: ProductDetail | null }
  | { slug: string; ok: false };

/** Apply fresh product data: new price/stock/name, vanished variants removed, qty re-clamped. */
export function applyRefresh(cart: GuestCart, refreshed: readonly ProductRefresh[]): GuestCart {
  const items = itemsOf(cart);
  for (const r of refreshed) {
    if (!r.ok) continue;
    for (const item of cart.items) {
      if (item.productSlug !== r.slug) continue;
      const variant = r.product?.variants.find((v) => v.id === item.variantId);
      if (r.product && variant) items.set(item.variantId, toCartSnapshot(r.product, variant));
      else items.delete(item.variantId);
    }
  }
  return normalize(quantitiesOf(cart), items);
}

/** Lines joined with their snapshots, for display and totals. */
export function cartViews(cart: GuestCart): CartLineView[] {
  const items = itemsOf(cart);
  return cart.lines.flatMap((line) => {
    const item = items.get(line.variantId);
    return item
      ? [{ ...item, quantity: line.quantity, maxQty: maxQtyFor(item.stockAvailable) }]
      : [];
  });
}
