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

Scaffold done (T4.2): routing, layout, auth session, role guards, data layer, i18n, tests. Every portal
page except the dashboards is a "coming soon" placeholder — T5.3 (vendor) and T5.4 (platform) fill them in.

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
                           page-header, locale-switcher, sign-out-button, error-alert
  pages/                   login, auth-callback, invite, home (redirect / chooser / no access),
                           dashboard, coming-soon, not-found, route-error
  lib/                     api-error (ApiError, unwrap, errorMessage), idempotency, use-api-mutation, query-client
  i18n/use-locale.ts       useLocale() / useT() + locale store
test/                      Vitest: guards.test.tsx, auth-store.test.ts, idempotency.test.tsx, lib.test.ts
```

## Routes

| Path                       | Access                             | Notes                                                                             |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `/login`                   | public (authenticated → `/`)       | Google / Facebook buttons → `${API}/v1/auth/<provider>?app=admin`                 |
| `/auth/callback`           | public                             | OAuth landing; shows `?error=<errorCode>` translated                              |
| `/invite`                  | public                             | Placeholder; T5.3 accepts staff invitations here                                  |
| `/`                        | signed in                          | 0 portals → "no access" + sign out; 1 → redirect; 2 → workspace chooser           |
| `/vendor`, `/vendor/*`     | `VENDOR_OWNER`, `VENDOR_STAFF`     | products, orders, shipping; wallet + staff **owner only**                         |
| `/platform`, `/platform/*` | `PLATFORM_STAFF`, `PLATFORM_ADMIN` | applications, vendors, products, orders, refunds; settings + users **admin only** |
| `*`                        | —                                  | 404 (inside the portal layout under `/vendor/*`, `/platform/*`)                   |

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
        params: { path: { id } },
        headers,
      }),
    ),
  );
  ```

  Key reuse: one key per **user action** = one set of variables until it succeeds. TanStack's automatic
  retries (transient errors, ≤ 2) and the user pressing "Try again" with the same input reuse the key, so
  the server replays instead of executing twice (it never caches errors, so reuse after a failure is safe).
  Different variables get their own key (interleaved `mutate(a)` / `mutate(b)` stay separate); success
  drops that action's key; `resetAction()` drops all. If you don't forward `headers`, the SDK generates a
  fresh key per request and retries are no longer idempotent.

- Errors: `<ErrorAlert error={query.error} />` or `errorMessage(locale, error)` — translates
  `errorCode` + `params` via `@repo/i18n`; a `fetch` rejection shows `admin.error.network`.

## i18n

- `useT()` / `useLocale()` from `@/i18n/use-locale`; all text under `admin.*` in
  `packages/i18n/src/messages/{en,vi}.ts` (en first — it is the shape source). Vietnamese uses Inter
  (`src/index.css`, `html[lang='vi']`).
- **Locale storage:** a Zustand store remembered in `localStorage` (`admin.locale`, default `vi`). An SPA
  has no locale URL segment or server cookie, and a locale preference is not sensitive. `App` keeps
  `<html lang>` in sync. Tokens never go to storage.

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
