# apps/admin — Platform admin + Vendor dashboard (`@apps/admin`)

Vite SPA serving two portals: platform console and vendor portal. Package name `@apps/admin`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model). This file holds only admin-specific context.

**Roles served:**

- `VENDOR_OWNER`, `VENDOR_STAFF` → `/vendor/*` routes
- `PLATFORM_STAFF`, `PLATFORM_ADMIN` → `/platform/*` routes

## Tech stack

- Vite 6 + React 19 + React Router 7 (data router, `createBrowserRouter`)
- TanStack Query 5 (server state) + typed `api` from `@repo/sdk`; Zustand 5 (auth session, locale, UI state)
- Tailwind v4 via **`@tailwindcss/vite`** (no postcss config); tokens + components from `@repo/ui` (same as `apps/client`). The old local shadcn `Button` in `src/components/ui/` is unused — prefer `@repo/ui`.
- i18n: `@repo/i18n` catalogs under `admin.*` (vi + en)
- Tooling: ESLint (`@repo/config/eslint` + `eslint-plugin-react-hooks`), Vitest 4 + Testing Library (jsdom)

## State (as of 2026-11-23)

Scaffold done (T4.2): routing, layout, auth session, role guards, data layer, i18n, tests. Vendor portal
done (T5.3, see "Vendor portal" below) and platform console done (T5.4, see "Platform console" below).

## Structure

```
src/
  main.tsx                 boot: restoreSession() (silent refresh) + render <App/>
  app.tsx                  QueryClientProvider + RouterProvider + Toaster; syncs <html lang>, clears cache on sign-out
  env.ts                   VITE_API_URL → API origin (`normalizeApiUrl`)
  auth/
    auth-store.ts          createSession(): Zustand auth store + @repo/sdk client wired together
    session.ts             app singletons `authStore`, `api`; hooks useAuth(selector), useCurrentUser()
    guards.tsx             <RequireAuth>, <RequireRole roles fallback>
    roles.ts               role groups, portalsFor(), hasAnyRole(), role label keys
    return-path.ts         deep link kept across the OAuth round-trip (sessionStorage, path only)
  router/
    routes.tsx             appRoutes (route table, also used by tests with createMemoryRouter)
    portals.tsx            VENDOR_PORTAL / PLATFORM_PORTAL: pages = sidebar links + routes + role limits
  components/              layout/ (portal-layout, sidebar-nav, user-menu), splash, centered-card,
                           page-header, locale-switcher, sign-out-button, error-alert, data-table, money-input,
                           status-badge, form-field, confirm-dialog, image-list-editor
  pages/vendor/            vendor portal pages (see "Vendor portal")
  pages/                   login, auth-callback, invite, home (redirect / chooser / no access),
                           dashboard, coming-soon, not-found, route-error; vendor/ (T5.3 portal pages); platform/ (T5.4 console pages)
  lib/                     api-error (ApiError, unwrap, errorMessage), idempotency, use-api-mutation, query-client,
                           money-input, use-cursor-list, upload, row-id, compact, bps, slug, settings-form
  i18n/use-locale.ts       useLocale() / useT() + locale store
test/                      Vitest: guards.test.tsx, auth-store.test.ts, idempotency.test.tsx, lib.test.ts
```

## Routes

| Path                       | Access                             | Notes                                                                                         |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `/login`                   | public (authenticated → `/`)       | Google / Facebook buttons → `${API}/v1/auth/<provider>?app=admin`                             |
| `/auth/callback`           | public                             | OAuth landing; shows `?error=<errorCode>` translated                                          |
| `/invite?token=`           | public                             | Staff invitation: signed out → `/login` (deep link kept); signed in → Accept → `/vendor`      |
| `/`                        | signed in                          | 0 portals → "no access" + sign out; 1 → redirect; 2 → workspace chooser                       |
| `/vendor`, `/vendor/*`     | `VENDOR_OWNER`, `VENDOR_STAFF`     | dashboard, products (+`new`, `:id`), orders (+`:id`), shipping; wallet + staff **owner only** |
| `/platform`, `/platform/*` | `PLATFORM_STAFF`, `PLATFORM_ADMIN` | applications, vendors, products, orders, refunds; settings + users **admin only**             |
| `*`                        | —                                  | 404 (inside the portal layout under `/vendor/*`, `/platform/*`)                               |

A user without the portal role is redirected to `/` (which re-routes them); a user lacking a page's
narrower role is redirected to the portal dashboard, and the sidebar hides that link. Guards are UX
only — the API enforces `@Roles` + ownership on every endpoint.

## Auth (Golden Rule #5)

- **Session store** (`auth-store.ts`, vanilla Zustand, **not persisted**): `status` (`restoring` →
  `authenticated` | `anonymous` | `error`), `accessToken` (memory only), `user` (`MeResponse`, parsed
  with the core Zod schema). The refresh token is the API's HttpOnly cookie — the app never sees it.
- **Boot:** `main.tsx` calls `restoreSession()`: `POST /v1/auth/refresh` (`credentials: 'include'`) →
  `GET /v1/auth/me`. Single-flight (StrictMode, `/auth/callback` and the retry button share one call).
  401/403 → `anonymous`; network error / 5xx → `error` (retry screen on guarded pages and on
  `/auth/callback`, the cookie may still be valid). Guards show the splash while `restoring`. A
  session end (sign-out, rejected SDK refresh) bumps an epoch, so a restore still in flight cannot
  resurrect it.
- **Afterwards** `@repo/sdk` refreshes on any 401 (its own single-flight) and writes the new token back
  via `onAccessToken`; a rejected refresh calls `onUnauthorized` → `anonymous` → `RequireAuth` sends the
  user to `/login`, and `App` clears the query cache.
- **Login flow:** `/login` saves the requested deep link (`location.state.from`) with `saveReturnPath`,
  leaves for the API OAuth start; the API redirects to `/auth/callback` (`AUTH_REDIRECT_URL_ADMIN`),
  where the boot refresh completes and the user is sent to the saved path (same-origin paths only;
  backslashes and control characters rejected), which is then cleared.
- **Sign out:** `authStore.getState().signOut()` → `POST /v1/auth/logout` → `anonymous` and resolves
  `true` (2xx, or 401 = no live session). Offline / 5xx resolves `false` and **keeps** the session — the
  cookie was not revoked and would sign the user back in on reload; `SignOutButton` shows a toast.
- Roles come from `/v1/auth/me` at boot; vendor roles count only while the vendor is ACTIVE (server).

## Data layer

- `api` (from `@/auth/session`) is the typed `@repo/sdk` client. In components use TanStack Query:
  `useQuery({ queryKey: ['vendor', 'products', params], queryFn: () => unwrap(api.GET('/v1/vendor/products', { params })) })`.
  `unwrap` returns `data` or throws `ApiError { status, errorCode, params }`.
- Queries retry only transient failures (network, 5xx, 429) — `retryTransient` in `lib/query-client.ts`.
- **Mutations: always `useApiMutation`** (`lib/use-api-mutation.ts`). It hands your function
  `headers` (`{ 'Idempotency-Key': … }`) — forward them to the request:

  ```ts
  const approve = useApiMutation((id: string, headers) =>
    unwrap(
      api.POST('/v1/platform/vendor-applications/{id}/approve', {
        params: { path: { id }, header: headers },
        body,
      }),
    ),
  );
  ```

  For routes whose OpenAPI declares the `Idempotency-Key` header, the typed slot is `params.header`
  (the SDK's `headers` option does not accept the `IdempotencyHeaders` interface); the SDK keeps a
  caller-supplied key either way. Optional query filters must be absent, not `undefined`
  (`exactOptionalPropertyTypes`): wrap them with `compact({ status, q, cursor })` from `lib/compact.ts`.

  Key reuse: one key per **user action** = one set of variables until it succeeds. TanStack's automatic
  retries (transient errors, ≤ 2) and the user pressing "Try again" with the same input reuse the key, so
  the server replays instead of executing twice (it never caches errors, so reuse after a failure is safe).
  Different variables get their own key (interleaved `mutate(a)` / `mutate(b)` stay separate); success
  drops that action's key; `resetAction()` drops all. If you don't forward `headers`, the SDK generates a
  fresh key per request and retries are no longer idempotent.
  **Typed ops that declare the header** (every vendor mutation in the generated schema) want it under
  `params.header`, not `headers`: `api.POST('/v1/…/{id}/accept', { params: { path: { id }, header: headers } })`
  (`headers` fails typecheck there; `params.header` is sent as the same request header).

- Errors: `<ErrorAlert error={query.error} />` or `errorMessage(locale, error)` — translates
  `errorCode` + `params` via `@repo/i18n`; a `fetch` rejection shows `admin.error.network`.

## i18n

- `useT()` / `useLocale()` from `@/i18n/use-locale`; all text under `admin.*` in
  `packages/i18n/src/messages/{en,vi}.ts` (en first — it is the shape source). Vietnamese uses Inter
  (`src/index.css`, `html[lang='vi']`).
- **Locale storage:** a Zustand store remembered in `localStorage` (`admin.locale`, default `vi`). An SPA
  has no locale URL segment or server cookie, and a locale preference is not sensitive. `App` keeps
  `<html lang>` in sync. Tokens never go to storage.

## Vendor portal (T5.3, `src/pages/vendor/`)

| Page (file)                                                           | API                                                                                                                       | Notes                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/vendor` (`vendor-dashboard-page`)                                   | `GET /v1/vendor/sub-orders?status=PAID\|PROCESSING&limit=100`; owner: `GET /v1/vendor/wallet`                             | counts cap at "100+"; tiles link to the filtered list; wallet tile owner only                                                                                                                                     |
| `products` (`products-page`)                                          | `GET /v1/vendor/products` (cursor, status filter)                                                                         | BLOCKED rows show `blockedReason`                                                                                                                                                                                 |
| `products/new`, `products/:id` (`product-edit-page` + `product-form`) | `POST/PUT /v1/vendor/products[/:id]`, `/publish`, `/archive`, `PATCH /v1/vendor/variants/:id/stock`, `GET /v1/categories` | vi + en both required; stock cannot go below `stockReserved`; BLOCKED = read-only; create → DRAFT; after a save the form remounts so new variants/images carry their ids                                          |
| `orders`, `orders/:id`                                                | `GET /v1/vendor/sub-orders[/:id]`, `POST …/accept\|ship\|deliver`                                                         | one action per status (`actionFor`): PAID accept, PROCESSING ship (carrier + tracking dialog), SHIPPED deliver; 409 `order.error.invalid-status-transition` refetches `['vendor','orders']`                       |
| `shipping`                                                            | `GET/POST /v1/vendor/shipping-methods`, `PUT /:id`, `POST /:id/deactivate`                                                | the edit dialog also re-activates (`isActive`)                                                                                                                                                                    |
| `wallet` (owner)                                                      | `GET /v1/vendor/wallet`, `GET /v1/vendor/ledger` (cursor)                                                                 | `pending[]` one line per currency                                                                                                                                                                                 |
| `staff` (owner)                                                       | `GET /v1/vendor/staff`, `GET/POST /v1/vendor/invitations`, `POST …/revoke`, `DELETE /v1/vendor/staff/:userId`             | owner and yourself cannot be removed; revoke only for PENDING                                                                                                                                                     |
| `/invite` (`pages/invite-page`)                                       | `POST /v1/vendor-invitations/accept` → `restoreSession()` (`/auth/refresh` + `/auth/me`) → `/vendor`                      | the new role exists only in a fresh token. 409 conflict = account already in a shop. The token rides in the return path (sessionStorage, same tab) across the OAuth round-trip and is removed by `/auth/callback` |

- **Shop currency = wallet currency** (server rule, see server CLAUDE.md "Vendor catalog"): the API refuses a product / shipping method priced in any other currency (422 `common.error.validation-failed {field: 'currency', expected}`). `useVendorCurrency()` (`vendor-currency.ts`) reads it from `GET /v1/vendor/wallet` for **owners** (same cached query as the dashboard): the new-product form and the shipping dialog default to it and offer only it (an existing shipping method in another currency also shows its own, so the vendor can switch it). **Staff** cannot read the wallet and no other endpoint exposes the vendor currency, so they keep the full VND/USD choice; a wrong pick shows the translated server error naming the expected currency (`errorMessage` → `admin.vendor.form.currencyMustMatch`).
- Responses are parsed with the core Zod schemas (`VendorProductSchema`, …): branded ids, and a drifting API fails loudly.
- **Money:** prices are typed as text and parsed to minor units with `lib/money-input.ts` (`parseMoneyInput`, BigInt, exact; extra decimals are rejected, never rounded; VND 0 decimals, USD 2). Shown with `formatMoney`.
- Product attributes are one text field per variant: `Color=Red, Size=M` (`parseAttributes`). The slug follows the name until edited by hand.
- Images: `lib/upload.ts` presigns (`product-image`), PUTs with the returned headers (no cookies), then sends `{ key }` for new images and `{ id }` for kept ones; array order = display order.
- Reusable widgets (neutral names, `src/components/` and `src/lib/`): `DataTable` + `useCursorList` (cursor pagination), `MoneyInput`, `StatusBadge`, `FormField`, `ConfirmDialog`, `ImageListEditor`, `uploadFile`, `newRowId`.
- Sub-routes without a sidebar link are declared in `PortalConfig.subRoutes` (`router/portals.tsx`).
- Tests: `test/vendor/*` (product form model + component, order actions, owner gating, invite flows, shop currency) with `test/vendor/fake-api.ts` (`stubApi` replaces global `fetch`); `test/money-input.test.ts`. Signed-in flows against a real API (OAuth) are not exercised.

## Env

| Var            | Example                 | Notes                                                                                       |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | `http://localhost:3001` | API **origin** (no `/v1`; a trailing `/v1` is stripped). **Public** — inlined in the bundle |

Vite reads `.env*` from the repo root (`envDir` in `vite.config.ts`). Anything `VITE_*` is public — never
put a secret there. CI sets it in `.github/workflows/deploy-admin.yml` (`https://elma-api-<branch>.fly.dev`).
The API must list the admin origin in `ADMIN_ORIGIN` (CORS with credentials) and be **same-site** with
the admin (one registrable domain, e.g. `admin.example.com` + `api.example.com`), otherwise browsers
do not send the SameSite=Lax refresh cookie on the cross-site `POST /v1/auth/refresh` and every boot
ends signed out. **Known gap:** the current deploy targets (`elma-admin.pages.dev` + `elma-api-*.fly.dev`)
are cross-site, so login will not stick there until a shared custom domain (or a same-origin `/v1`
proxy) is set up — an infra decision outside this app.

## Platform console (`/platform/*`, T5.4)

Pages live in `src/pages/platform/`; all use cursor lists (`useCursorList` + `<CursorTable>`, "Load more"),
`useApiMutation` and `admin.platform.*` i18n keys. Roles: STAFF and ADMIN see everything except the
admin-only rows below (sidebar + route guard + in-page gating; the API enforces it too).

| Path                     | Role  | Notes                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/platform`              | any   | Pending applications / refunds counts (first 100, shown "100+" beyond) + 5 recent orders                                                                                                                                                                                                                        |
| `/platform/applications` | any   | Masked list + status filter. `?id=` opens the detail dialog: full numbers + KYC links (`target=_blank rel=noopener`), fetched on every open with `gcTime: 0` (60 s presigned URLs, never cached). Approve (name + slug, slug suggested from name via `lib/slug.ts`, 409 → "slug taken") / Reject (reason ≤ 500) |
| `/platform/vendors`      | any   | Status filter + search; Suspend (reason) / Reactivate                                                                                                                                                                                                                                                           |
| `/platform/products`     | any   | Status / shop / search; Block (reason) / Unblock                                                                                                                                                                                                                                                                |
| `/platform/orders`       | any   | Search by id prefix / customer email + status. `?id=` opens detail: sub-orders + items, payments (no raw payload), ledger, refunds. **ADMIN only:** "Refund sub-order" (reason; server `not-refundable` reason shown)                                                                                           |
| `/platform/refunds`      | any   | Status filter; links to the order                                                                                                                                                                                                                                                                               |
| `/platform/settings`     | ADMIN | Commission as percent (`lib/bps.ts`: exact integer bps ↔ percent, ≤ 2 decimals), hold / refund-window days, payment timeout, max coupon stack, currencies. `lib/settings-form.ts` mirrors the server bounds (default ∈ supported)                                                                               |
| `/platform/users`        | ADMIN | Search; grant / revoke PLATFORM_STAFF / PLATFORM_ADMIN. `params.reason` (`last-platform-admin`, `self-demotion`, `not-platform-admin`) maps to specific texts in `errorMessage`                                                                                                                                 |

Reusable widgets in `src/components/`: `status-badge` (enum → translated coloured badge), `money-text`
(core `Money` via `formatMoney`), `confirm-reason-dialog` (required trimmed 1..500 reason: suspend, block,
reject, refund), `cursor-table`, `filter-bar` (`FilterSelect`, `SearchForm`, `FilterBar`).
`errorMessage` (lib/api-error.ts) also turns `refund.error.not-refundable` `params.reason` into an extra
sentence.

Tests: `test/platform-lib.test.ts` (bps, slug, settings validation, reason mapping) and
`test/platform-pages.test.tsx` (approve / reject dialogs, role gating, refund, settings, users, dashboard;
global `fetch` faked). Signed-in flows need the OAuth round-trip, so they are covered by these tests, not
exercised in a real browser.

## Adding a portal page (T5.3 / T5.4)

1. Create the page in `src/pages/<portal>/<name>-page.tsx` (kebab-case file, `export function XxxPage`),
   starting with `<PageHeader title={t('admin.nav.<name>')} />`.
2. In `src/router/portals.tsx`, replace that entry's `comingSoon(...)` with
   `{ path, labelKey, icon, roles?, element: <XxxPage /> }`. Keep `roles` for owner/admin-only pages —
   it drives both the sidebar and the route guard. Sub-routes (`products/:id`) go in `routes.tsx` under
   the same portal (wrap them in `RequireRole` with the same `roles`).
3. Reads: `useQuery` + `unwrap(api.GET(...))`; writes: `useApiMutation` (forward its `headers`), then
   `queryClient.invalidateQueries`. Forms validate with the `@repo/core` schema.
4. Text: add `admin.<area>.*` keys to `en.ts` then `vi.ts` (with diacritics).
5. Test: component test under `test/` (render with `createMemoryRouter(appRoutes, …)` + set
   `authStore` state, see `test/guards.test.tsx`); mock `fetch` like `test/auth-store.test.ts`.

## Commands

```bash
pnpm --filter @apps/admin dev        # → http://localhost:5173
pnpm --filter @apps/admin lint       # eslint . --max-warnings 0
pnpm --filter @apps/admin typecheck  # tsc for src + test, and vite/vitest configs
pnpm --filter @apps/admin test       # vitest run
pnpm --filter @apps/admin build      # tsc -b && vite build (needs @repo/core, i18n, sdk built: `pnpm turbo build --filter=@apps/admin`)
```

E2E (Playwright, later): vendor apply → admin approve → vendor lists a product.
