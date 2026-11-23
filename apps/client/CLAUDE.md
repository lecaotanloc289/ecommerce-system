# apps/client — Storefront (`@apps/web`)

Customer-facing storefront. Public, i18n vi/en. Physical dir `apps/client`, package name `@apps/web`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model). This file holds only storefront-specific context.

**Roles served:** `GUEST`, `CUSTOMER`.

## Tech stack

- Next.js 15 App Router, React 19, Server Components by default — **SSR on Cloudflare Workers** via `@opennextjs/cloudflare` (roadmap D1)
- Tailwind v4 via **`@tailwindcss/postcss`** plugin (declared in `postcss.config.mjs`). shadcn/ui imported from `@repo/ui`; locally configured with `components.json` (`rsc: true`, `style: new-york`, `baseColor: neutral`, css vars). `cn()` helper in `src/lib/utils.ts`.
- `next-intl` for i18n (vi/en), route prefix `/vi`, `/en`
- TanStack Query for client cache (prefer Server Actions / RSC fetch for reads)
- `react-hook-form` + `@hookform/resolvers/zod` for forms (schemas from `@repo/core`)
- API calls go through `@repo/sdk` (typed)

## Rendering + i18n routing

- **Runtime:** Next.js server output adapted by OpenNext into a Worker (`.open-next/worker.js` + `.open-next/assets`). Config: `wrangler.jsonc` (`nodejs_compat`, `ASSETS` binding, envs `dev` / `prod` → Workers `elma-web-dev` / `elma-web-prod`) and `open-next.config.ts` (read-only `staticAssetsIncrementalCache`: prerendered pages are served from assets, no revalidation — switch to the R2 cache when pages use ISR / `revalidate`). `next.config.ts` calls `initOpenNextCloudflareForDev()` so `getCloudflareContext()` works under `next dev`.
- **Routes:** every page lives under `src/app/[locale]/…`; URLs are `/vi/…` and `/en/…` (`localePrefix: 'always'`). `src/middleware.ts` (next-intl) redirects a bare path (`/`, `/cart`) to `NEXT_LOCALE` cookie → `Accept-Language` → `vi`; its matcher lists the locales literally (`/(vi|en)/:path*`) — update it when `APP_LOCALES` changes — and otherwise skips only `api/`, `_next/`, `_vercel/` and paths ending in a real static-asset extension (`.ico`, `.png`, `.js`, …), so a bare `/product/x-4.5` still gets the redirect (`test/middleware.test.ts`). Static pages (cart, checkout, sign-in, …) are meant to be prerendered for both locales (`generateStaticParams` in `[locale]/layout.tsx` only) — note: `next build` currently emits an empty `prerender-manifest.json` (no HTML), so every route renders per request; this predates T4.1 and is still to be investigated. API-backed pages are `force-dynamic` (see "Data fetching") — don't add `dynamicParams = false`, slugs come from the API. Product and category pages accept either language's slug and redirect to the one of the page's locale.
- **Layouts:** `app/layout.tsx` is a pass-through; the document (`<html lang={locale}>`, fonts, `NextIntlClientProvider`, auth/cart/checkout providers, navbar, footer) is `components/layout/storefront-shell.tsx`, used by `[locale]/layout.tsx` and by `app/not-found.tsx`. Next renders a `notFound()` thrown during SSR (unknown slug, `[locale]/[...rest]`) through the **root** not-found, so that file rebuilds the shell with the locale from `getLocale()` (set by the middleware); `[locale]/not-found.tsx` covers client navigations. Both render `NotFoundContent`.
- **Translation:** next-intl provides only routing + the current locale (`src/i18n/request.ts` returns no messages; the provider gets `messages={null}`). Text is translated with `createTranslator` from `@repo/i18n` — one translator, one catalog. Add or change UI text in `packages/i18n/src/messages/{en,vi}.ts`, never in components.
  - Client component: `const { locale, t } = useLocale()` or `const t = useT()` from `@/i18n/use-locale`.
  - Server component / page: `const locale = await pageLocale(params); const t = createTranslator(locale);` — `pageLocale` (`@/i18n/page-locale`) validates the segment (unknown → 404) and calls `setRequestLocale`. Elsewhere on the server, `getLocale()` from `next-intl/server`.
  - Formatting: `formatMoney` / `formatDate` / `formatCompact` from `@repo/i18n` with that `locale`.
  - `AppLocale` (`'vi' | 'en'`) is next-intl's `Locale` type via `src/global.d.ts`.
- **Navigation:** import `Link`, `useRouter`, `usePathname`, `redirect` from `@/i18n/navigation` (never `next/link` / `next/navigation` routing hooks) and pass locale-less paths (`/cart`); the prefix is added. `notFound` and `useSearchParams` still come from `next/navigation`. `LocaleToggle` swaps the prefix on the current path + query (`router.replace(href, { locale })`).

## Data fetching (recipe — T5.x must follow it)

| Where                                  | Module                                    | Use for                                                                                    |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| RSC page / `generateMetadata` (server) | `src/lib/api/server.ts`                   | Public catalog reads: categories, products, search, vendor, reviews (first page), settings |
| Client component (browser)             | `src/lib/api/browser.ts` → `browserApi()` | Everything signed-in (cart, checkout, orders, me) and all mutations; "load more" paging    |

- **Server reads** (`server.ts`): plain `openapi-fetch` typed with `paths` from `@repo/sdk`, against `serverApiOrigin()` (`API_URL ?? NEXT_PUBLIC_API_URL`). No auth, no cookies, no `credentials` (anonymous GETs only). Each reply is parsed through its `@repo/core` schema (branded ids, Money). A 404 calls `notFound()`; any other non-2xx throws `ApiError` → `[locale]/error.tsx`. Add a new read as a `cache()`-wrapped function (primitive args) or via `memoize()` for object params, so a page + its `generateMetadata` share one call per request.
- **No ISR:** OpenNext runs with the read-only `staticAssetsIncrementalCache`, so `revalidate` would never refresh. API-backed pages export `dynamic = 'force-dynamic'` (rendered per request). Switching to ISR needs the R2 incremental cache (`open-next.config.ts` + an R2 binding).
- **Rate limit (known limitation):** SSR fetches leave from the Worker's egress IP, so every visitor's SSR calls share ONE API rate-limit bucket (`RATE_LIMIT_MAX`/min per IP, `server/CLAUDE.md` "Rate limit"). Mitigations here: per-request de-duplication (`cache()` / `memoize()`) and parallel fetches; pages make 1–4 calls. Not fixed server-side yet — the API needs an allow-list / trusted-client key for the storefront before real traffic. A 429 during SSR renders the error page.
- **Browser calls** (`browserApi()`): `createApiClient` from `@repo/sdk` bound to the auth store — Bearer token from memory, `credentials: 'include'`, auto `Idempotency-Key` on POST/PUT/PATCH (pass your own per user action to make retries safe), single-flight refresh + one retry on 401. Parse replies with `parseResult(result, CoreSchema)` (`src/lib/api/errors.ts`); show `errorCode` with `translateError(locale, code)`.
- **Money / text:** API Money is integer minor units — render with `formatMoney(money, locale)`, do math with `@repo/core/money`. Catalog endpoints take `?locale=vi|en` = the page's locale. Catalog filters live in the URL in whole major units (`?sort=&min=&max=`); `src/lib/catalog-query.ts` converts to minor units for the API.

## Auth (Golden Rule #5)

- **Store:** `src/store/auth-store.ts` (`createAuthStore`, framework-free, Vitest-covered) + `src/store/auth-provider.tsx` (`AuthProvider` in `StorefrontShell`, `useAuth()` → `{ status: 'loading'|'authenticated'|'anonymous', user: MeResponse|null, signIn(provider, returnTo?), signOut(), restore() }`). The access token lives only in the store's closure — never in storage, cookies or React state.
- **Restore on mount:** `AuthProvider` calls `restore()` once per page load: `POST /v1/auth/refresh` (HttpOnly cookie, Path `/v1/auth`) → token in memory → `GET /v1/auth/me`. Single-flight (StrictMode, provider + callback page share one refresh); API calls made meanwhile wait for its token. No cookie → `anonymous`.
- **Sign-in:** `/sign-in` and `/register` (navbar link adds `?returnTo=<current path>`) → Google/Facebook button → `signIn()` saves the sanitized locale-less `returnTo` path in sessionStorage (a path, never a token) and navigates to `${NEXT_PUBLIC_API_URL}/v1/auth/{google|facebook}?app=web`. The API callback sets the refresh cookie and redirects to `AUTH_REDIRECT_URL_WEB` = `/auth/callback` (middleware adds the locale) → `[locale]/auth/callback` runs `restore()` and `router.replace(returnTo)` (`src/lib/return-to.ts`: rejects external / `//` URLs and the auth pages). `?error=<errorCode>` (e.g. `auth.error.oauth-failed`) is shown translated on the callback and sign-in pages.
- **Session upkeep:** 401 → the SDK refreshes once and retries; a rejected refresh → `onUnauthorized` → `anonymous`. Navbar `UserMenu`: name + sign-out (`POST /v1/auth/logout`; memory is cleared only once the API confirms — otherwise an error is shown and the session kept, since the cookie would restore it on reload). A restore still in flight when the user signs out is discarded.
- **Local dev:** the refresh cookie is `Secure` + `SameSite=Lax`: use Chrome on `http://localhost` (Safari may drop it); web (`:3000`) and API (`:3001`) are same-site on localhost. In prod the API must be same-site with the storefront.

## Current state (as of 2026-11-23)

UI for the `SCREENS.md` storefront screens built from the Elma kit. **On the API (T4.1):** home (latest / top-rated / best-price lists + category tiles), `/categories` (tree), `/categories/[slug]` (breadcrumb, subcategories, sort + price filter, load more), `/search` (`?q=` → `GET /v1/search`; no `q` → all products with filters), `/product/[slug]` (gallery, variant chips — sold-out disabled, price per variant, stock, vendor card, reviews + rating summary with "show more", related products from the same category), `/vendors/[slug]` (shop header + filtered products), auth (sign-in/register/callback, navbar user menu). `generateMetadata` (title, description, OG image) on product, category and vendor pages.

Interim deviations (to be replaced, not copied):

- **Cart (T5.1):** one `CartProvider` (`src/store/cart-store.tsx`) with two sources behind the same `useCart()` (`lines: CartLineView[]`, `itemCount`, `hasMixedCurrency`, async `add/setQty/remove/refresh`). **Guest** (anonymous): pure logic in `src/lib/guest-cart.ts`, persisted in localStorage `guest-cart.v2` (`{ lines: CartLineInput[], items: CartItemSnapshot[] }`, sanitized, synced across tabs, `refresh` re-reads each product). **Server** (signed in): `GET/PUT/DELETE /v1/cart…` via `src/lib/api/commerce.ts`, flattened by `src/lib/server-cart.ts`; mutations are queued one at a time. When auth turns `authenticated` the provider calls `POST /v1/cart/merge` **once** with the guest lines (`src/lib/cart-merge.ts`: single-flight, idempotency key kept in sessionStorage `cart-merge` until it succeeds, so a retry replays instead of double-adding), clears the guest cart and toasts `CLAMPED` / `UNAVAILABLE` adjustments. `unavailable` lines are greyed out, excluded from totals/badge/checkout and removable; `hasMixedCurrency` disables checkout. The header badge is `itemCount` of the active cart. A second currency is refused when adding (roadmap D6).
- **Checkout (T5.1):** requires sign-in (guests: `/sign-in?returnTo=`). Steps `/checkout/info` (saved addresses + add-address dialog, `components/address/` is reusable by the address book) → `/checkout/shipping` (one method per vendor from `GET /v1/cart/shipping-options`, cheapest preselected; provider picker, VNPay disabled for non-VND carts) → `/checkout/review` (coupon codes, the "Get order updates on Zalo" opt-in — default off, sent as `Checkout.zaloOptIn` and part of the request fingerprint, roadmap D16 —, labelled **estimate** — subtotal + chosen shipping; the server prices coupons/final totals). `CheckoutProvider` keeps only ids/codes in sessionStorage `checkout.v2`; `useCheckoutGuard` (`lib/checkout.ts: checkoutGuard`) redirects to the step that must be completed first. **Place order:** `POST /v1/orders/checkout` with one `Idempotency-Key` created when the review page mounts (replaced only if the body changes), then `usePaymentFlow` polls `GET /v1/orders/:id/payment` (1 s, ≤ 30 s, 202 = keep polling; `lib/payment-session.ts`) and `window.location.assign(redirectUrl)`; timeout → retry. API errors map to a step via `lib/checkout-errors.ts: stepForError` (cart / info / shipping / review) and are shown there as a notice.
- **Orders (T5.1):** `/order/success?orderId=` polls `GET /v1/orders/:id` until PAID/terminal (VNPay's return can beat its IPN; `lib/order-poll.ts`); `/order/payment-failed?orderId=|error=` offers retry (`POST /v1/orders/:id/payments`, optional provider switch, then the same polling) and cancel; `/account/orders` (cursor list) and `/account/orders/[id]` (sub-orders per vendor, status timeline from status + timestamps + carrier/tracking — `lib/order-status.ts`; actions: pay again, cancel while every sub-order awaits payment, `confirm-received` for SHIPPED/DELIVERED). `/order/track` redirects to the order detail (`?orderId=`) or the list.
- **Platform tunables:** the free-shipping threshold (benefit bar) still comes from `src/mocks/platform-settings.ts`; catalog price filters use `GET /v1/platform-settings/public` → `defaultCurrency`.
- **Types:** all shapes come from `@repo/core` (`ProductSummary`, `Cart`, `Order`, `ShippingMethod`, …); `src/types.ts` only re-exports `Money`/`Currency`. No mock data is left except the free-shipping threshold above.
- The wishlist, blog and brand pages don't exist; the brand strip and mock-only product fields (badges, specs, colors) were removed.

## Account, sell, reviews (T5.2)

All signed-in calls go through `src/lib/api/account.ts` (`browserApi()` + `parseResult`; every mutation takes one fixed `Idempotency-Key` per user action, made with `newIdempotencyKey()` in `src/lib/idempotency.ts` and reset when the form changes, so a retry of the same submit replays). Errors are shown with `describeError(locale, error)` (`src/lib/api/error-message.ts` → `translateError`). Forms are controlled React state validated with the `@repo/core` schemas (pure helpers in `src/lib/{addresses,vendor-application,review-form}.ts`, Vitest-covered); core's English messages are never shown — `src/lib/form-errors.ts` maps issues to `form.required|tooLong|invalid` keys. Text lives under `account.*`, `addr.*`, `sell.*`, `review.*`, `form.*`.

- **Auth gate:** `components/account/account-shell.tsx` wraps `/account*` in `RequireAuth` — while the session restores it shows "loading", an anonymous visitor is `router.replace`d to `/sign-in?returnTo=<path+query>`. Account nav: Profile, Addresses, Orders (`/account/orders`, built by T5.1), Sell on Elma; the navbar menu has the same shortcuts.
- **`/account`:** name + preferred language (`PATCH /v1/me`, `primaryLocale` via `toCoreLocale`), then `useAuth().refreshUser()` (profile re-read, no token rotation) so the navbar name updates. Email is read-only.
- **`/account/addresses`:** `components/address/address-book.tsx` (list default-first, add / edit / delete with inline confirm / set default; list state kept consistent with `withDefault` / `withoutAddress`, a create re-reads the list). **`components/address/address-form.tsx`** is reusable (checkout): `<AddressForm initial? onSaved onCancel? />` persists the address itself (POST, or PATCH with only the changed fields) and reports the stored row. Fields: recipient, phone, line1/2, ward, district, city, country (default VN).
- **`/sell`:** public pitch; signed-in users see their application from `GET /v1/vendor-applications/me` (`applicationView`: none / PENDING / APPROVED / REJECTED + older history) and the form when none exists or after a rejection ("Apply again"). Documents: `kyc-file-field.tsx` checks type (jpeg/png/webp/pdf) and size (≤ 10 MB) locally, then `uploadKycFile` (`src/lib/uploads.ts`): `POST /v1/uploads/presign {purpose:'kyc'}` → `PUT` to the presigned `url` with the returned headers via XMLHttpRequest (progress; `content-length` is left to the browser) → the `key` goes into `POST /v1/vendor-applications` (the two keys must differ). Handled errors: `vendor.error.application-already-pending` (re-reads the status), `common.error.conflict` (already a vendor), `upload.error.*`. APPROVED: the page calls `useAuth().reload()` once (forced `POST /v1/auth/refresh` + `/auth/me`; the vendor role is only in the token after a refresh) and links to the seller portal `${NEXT_PUBLIC_ADMIN_URL}/vendor` (`vendorPortalUrl()`; link hidden in production when unset).
- **Reviews:** `components/review/review-form.tsx` (`<ReviewForm productId subOrderId onCreated onAlreadyReviewed? />`: 1–5 star radio group, optional text ≤ 2000, `POST /v1/products/:id/reviews`). The product page shows it via `ReviewEntry` when the URL has **`?reviewSubOrderId=<sub-order ULID>`** and the visitor is signed in (guests get a sign-in link back to the same URL); that param also opens the Reviews tab. After a success `ProductReviews` re-reads page 1 (list + summary). **The order detail (`/account/orders/[id]`) links DELIVERED/COMPLETED sub-order items to `/product/<slug>?reviewSubOrderId=<subOrderId>#reviews`** (`reviewHref` in `lib/order-status.ts`, slug = `OrderItem.productSlug`, no link when null); the API decides eligibility (`review.error.not-eligible` / `already-exists` are shown translated).
- **Not exercised end-to-end** (no OAuth session in CI/dev scripts): the signed-in screens, real S3 PUT with progress, the approved → refresh → portal flow. Covered by unit tests of the pure logic and the auth store; Playwright smoke belongs to T6.1.

## Env

| Var                     | Where                       | Notes                                                                                                                                                                       |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`   | browser (+ server fallback) | API **origin** (`http://localhost:3001`; a trailing `/v1` is stripped). Inlined at build time — CI sets it per env.                                                         |
| `API_URL`               | server only, optional       | Origin the SSR Worker uses instead (e.g. an internal URL). Read at request time.                                                                                            |
| `NEXT_PUBLIC_ADMIN_URL` | browser                     | Admin app origin (`http://localhost:5173`); `/sell` links approved vendors to `<origin>/vendor`. Inlined at build time. Unset → dev default locally, no link in production. |

Unset outside production → `http://localhost:3001`; unset in production → requests fail with a clear error. Next reads `apps/client/.env*` (not the root `.env`) or the shell env.

## Run

`@repo/i18n`, `@repo/core` and `@repo/sdk` are consumed from their built `dist/`. Catalog pages need the API running (`pnpm --filter @server/api dev`, default `http://localhost:3001`) — without it they render the error page. `pnpm dev` (turbo) builds them once at start (no watch — after editing package source, re-run the build); for a bare filtered run, build them once: `pnpm turbo run build --filter=@apps/web^...`.

```bash
pnpm --filter @apps/web dev          # next dev → http://localhost:3000 (redirects to /vi)
pnpm --filter @apps/web build        # next build only (Node output in .next/)
pnpm --filter @apps/web start        # next start on :3000 (after build)
pnpm --filter @apps/web preview      # OpenNext build + wrangler dev: the real Workers runtime, local
pnpm --filter @apps/web run deploy   # OpenNext build + deploy Worker `elma-web` (no env) — CI normally does this
pnpm --filter @apps/web cf-typegen   # wrangler types → cloudflare-env.d.ts (CloudflareEnv) once bindings are added
pnpm --filter @apps/web test         # Vitest (test/): auth store, guest cart, cart merge-once, checkout guards + error→step mapping, payment-session polling, order status timeline, query mapping, middleware matcher
```

Use `pnpm run deploy`, not `pnpm deploy` (that is pnpm's built-in workspace deploy command). Deploying needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. CI targets an environment by running, from `apps/client`, `pnpm exec opennextjs-cloudflare build --env <dev|prod>` then `pnpm exec opennextjs-cloudflare deploy --env <dev|prod>` (`.github/workflows/deploy-web.yml`). `@repo/core` / `@repo/i18n` / `@repo/sdk` must be built first (`pnpm turbo run build --filter=@apps/web^...`). Build output `.open-next/` and wrangler state `.wrangler/` are git-ignored.

E2E (Playwright) is not set up yet (T6.1): planned smoke flows are OAuth sign-in (mocked provider), browse → add to cart → checkout. T5.1 flows were verified against the built API with minted tokens (see the task report), not in a browser.

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
   - Guest cart in `localStorage` (lines: `variantId`, `quantity` — core `CartLineInput`).
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
