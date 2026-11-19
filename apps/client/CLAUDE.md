# apps/client — Storefront (`@apps/web`)

Customer-facing storefront. Public, i18n vi/en. Physical dir `apps/client`, package name `@apps/web`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model). This file holds only storefront-specific context.

**Roles served:** `GUEST`, `CUSTOMER`.

## Tech stack

- Next.js 15 App Router, React 19, Server Components by default
- Tailwind v4 via **`@tailwindcss/postcss`** plugin (declared in `postcss.config.mjs`). shadcn/ui imported from `@repo/ui`; locally configured with `components.json` (`rsc: true`, `style: new-york`, `baseColor: neutral`, css vars). `cn()` helper in `src/lib/utils.ts`.
- `next-intl` for i18n (vi/en), route prefix `/vi`, `/en`
- TanStack Query for client cache (prefer Server Actions / RSC fetch for reads)
- `react-hook-form` + `@hookform/resolvers/zod` for forms (schemas from `@repo/core`)
- API calls go through `@repo/sdk` (typed)

## Current state (as of 2026-11-19)

UI for the 12 storefront screens in `SCREENS.md` (home, categories, search, product/[slug], cart, checkout info/shipping/review, order success/track, sign-in, register) built from the Elma kit against **mock data** (`src/mocks/`). No API calls yet — `@repo/sdk` doesn't exist.

Interim deviations from the stack above (to be replaced, not copied):

- **i18n:** static export (`output: 'export'`) rules out next-intl route prefixes/middleware, so locale lives in a client `LocaleProvider` (`src/i18n/locale-provider.tsx`, choice persisted in `localStorage`). The provider is React glue only: catalogs, `MessageKey`, `createTranslator`, `formatMoney` / `formatDate` / `formatCompact` and the `AppLocale` type (`'vi' | 'en'`) all come from `@repo/i18n`. Add or change UI text in `packages/i18n/src/messages/{en,vi}.ts`, never in components.
- **Types:** `src/types.ts` re-exports `Money` / `Currency` from `@repo/core` and derives `PaymentProviderId` (`Lowercase<PaymentProvider>` + UI-only `wallet`) and `OrderStatus` (forward path of core `SubOrderStatus`). Product, ProductVariant, Category, CartLine, ShippingMethod, Voucher, Review and TrackingStep stay local mock/display shapes. They differ from core's API read shapes (e.g. `title` vs `name`, `price` vs `basePrice`, label/stock variants vs sku/attributes/stockAvailable, non-ULID mock ids), and are replaced when pages read `@repo/sdk` responses.
- **Money math:** all cart/checkout arithmetic and voucher checks live in `src/lib/cart.ts` and go through `@repo/core/money` (`multiply`, `sum`, `subtract`, `compare`, `zero`), and `meetsMinSpend` is shared with the voucher form. Core throws on a currency mismatch or a non-integer amount/qty, so lines, shipping fee and voucher must share the cart currency. A voucher whose minimum spend is in another currency is treated as inapplicable. Display-only comparisons elsewhere (e.g. `compareAt` vs `price`, search price range) still read `.amount` directly.
- **Auth pages** render only the Google + Facebook OAuth buttons (Golden Rule #5); handlers are no-ops.
- **Guest cart:** `CartProvider` (`src/store/cart-store.tsx`) keeps lines `{ productId, variantId, qty }` in `localStorage` (`guest-cart`), seeded from `src/mocks/cart.ts` on first visit and resolved against the mock catalogue (unit price = variant price when a variant is chosen). Stored data is sanitized (unknown ids dropped, duplicates merged, qty clamped to stock) and synced across tabs via the `storage` event. State is empty until hydrated (`hydrated` flag) so the prerendered HTML never shows stale lines. Qty change / remove / add-to-cart work client-side; "Place order" clears the cart and checkout choices. Merge into the server `Cart` comes with the API.
- **Checkout store:** `CheckoutProvider` (`src/store/checkout-store.tsx`) holds `{ shippingMethodId, voucherCode }` in `sessionStorage` (`checkout`). `useOrderTotals()` feeds every summary through `computeTotals()` (`src/lib/cart.ts`): shipping fee from the selected mock `ShippingMethod`, discount from the mock voucher table (`vouchers` in `src/mocks/cart.ts`, FIXED only). Both providers are mounted in the root layout so the cart page and all checkout steps share them.
- **Platform tunables** (free-shipping threshold, default currency) come from `src/mocks/platform-settings.ts` until `PlatformSettings` is served by the API.

## Run

`@repo/i18n` and `@repo/core` are consumed from their built `dist/`. `pnpm dev` (turbo) builds them once at start (no watch — after editing package source, re-run the build); for a bare filtered run, build them once: `pnpm turbo run build --filter=@apps/web^...`.

```bash
pnpm --filter @apps/web dev          # → http://localhost:3000
pnpm --filter @apps/web e2e -- --headed   # Playwright headed
```

E2E (Playwright) smoke flows: OAuth sign-in (mocked provider), browse → add to cart → checkout.

## Customer journey (features in scope for MVP)

1. **Sign up / Sign in — OAuth only (Google, Facebook).**
   First-time login auto-creates a `User` with role `CUSTOMER`. If an existing `User` has the same verified email, the new `OAuthIdentity` is linked to it (one `User` ↔ many `OAuthIdentity`). No email/password flow exists.

2. **Browse products.**
   Paginated list with filters (category, price range, vendor, attributes via JSONB, in-stock only). Sort by relevance / price / newest / best-selling.

3. **Search.**
   Postgres FTS on `tsvector(title, description, brand)` + `pg_trgm` for typo tolerance. Results include matching products and matching categories.

4. **Product detail.**
   Title, description, gallery, variants (e.g. color/size → SKU + price + stock), JSONB attributes, vendor card (rating + link to vendor storefront), review summary, related products from same category.

5. **Categories.**
   Tree with `parent_id`. Localized names live in `category_translations` (vi/en). Products are linked many-to-many. Browsing a category returns its products and optionally those of its descendants.

6. **Cart.**
   - Guest cart in `localStorage` (lines: `productId`, `variantId`, `qty`).
   - On sign-in, the guest cart **merges** into the server `Cart` (same user → quantities sum, capped at stock).
   - Once authenticated, the server `Cart` is the source of truth.
   - Multi-vendor lines are allowed in a single cart; the UI groups lines by vendor.
   - Stock is checked at view time and again at checkout; reservation only happens at checkout (Golden Rule #4).

7. **Shipping addresses.**
   `Address` table per user (label, recipient, phone, line1/line2, ward, district, province, country, postal). One row may be `is_default`. The address book is shown at checkout for selection. Editing an address must not mutate addresses already snapshotted onto past `SubOrder` rows.

8. **Shipping methods.**
   Each vendor defines a set of `ShippingMethod` (e.g. STANDARD, EXPRESS, FREESHIP_ON_PROMO). A rate calculator in `packages/core/shipping` takes `{ weight, destination_province, subtotal }` and returns a fee. The customer picks **one method per sub-order** at checkout, because different vendors can ship differently.

9. **Coupons / discount codes.**
   - `Coupon`: `code` (unique), `scope` (`PLATFORM` or `VENDOR_ID`), `type` (`PERCENT` or `FIXED`), `value` (FIXED = amount in minor units; PERCENT = basis points, 1000 = 10%), `min_subtotal_amount`, `max_redemptions_total`, `max_redemptions_per_user`, `starts_at`, `ends_at`, `is_active`.
   - `CouponRedemption` log enforces per-user and total caps **inside the checkout transaction**.
   - Stacking rule: at most 1 `PLATFORM` + 1 `VENDOR` coupon per sub-order; validated server-side.
   - Discounts apply **before** commission calc; commission is on the discounted subtotal.

10. **Payment methods.**
    At checkout the customer picks one provider:
    - **VNPay** (VND only): redirect flow → webhook confirms.
    - **Stripe** (USD, international): Payment Intents → 3DS as needed → webhook confirms.
    - **Wallet** (later): customer-funded wallet; checkout debits it.

    Payment provider applies to the **entire order**; escrow split into sub-order ledger entries happens after capture.
