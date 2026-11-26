/**
 * Storefront-only types. Catalog, cart, checkout and order shapes come from `@repo/core`
 * (Golden Rule #1) — `ProductSummary`, `Cart`, `Order`, `ShippingMethod`, … — and the cart view
 * types live in `src/lib/cart.ts`.
 * Money is integer minor units + ISO currency (Golden Rule #2): VND = đồng, USD = cent.
 */
export type { Currency, Money } from '@repo/core';
