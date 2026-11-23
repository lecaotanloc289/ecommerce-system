# e2e — cross-system smoke suite (`@repo/e2e`)

Playwright flows that drive the **real** storefront, admin, API and worker against an isolated,
migrated, seeded database. Read the root `CLAUDE.md` first (§10 Testing). Nothing here ships:
no production code depends on this workspace.

**Why one workspace, not `apps/*/e2e`:** the flows cross apps (customer buys on the storefront →
vendor fulfils in the admin → worker pays out) and need the same booted stack, database and
sessions. Per-app folders would each boot the full stack and could not share state. This workspace
may import `@repo/*` packages only (never `apps/*` or `server/` — the boot script runs them as
separate processes).

## Run

```bash
pnpm e2e                 # build + boot the stack, run all flows headless, tear down
pnpm e2e:headed          # same, visible browser
pnpm e2e -- -g payout    # extra args go to `playwright test`
```

Session minting (`server/test/e2e/mint-sessions.ts`) only runs with `E2E_MINT_SESSIONS=1` (set by the runner) against an `e2e_<hex>` database. Needs Postgres and Redis reachable (`pnpm services:up`, or the CI services). Env:

| Var                                     | Default                                                  | Meaning                                                                          |
| --------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `E2E_PG_ADMIN_URL`                      | `postgresql://postgres:postgres@localhost:5432/postgres` | Server used to create/drop the throwaway `e2e_<random>` database                 |
| `E2E_REDIS_URL`                         | `redis://localhost:6379/13`                              | **Dedicated logical DB, flushed at start and end** — never point at real data    |
| `E2E_SKIP_BUILD=1`                      | unset                                                    | Reuse the previous builds (the frontends bake the e2e ports in at build time)    |
| `E2E_BROWSER_CHANNEL`                   | unset (bundled Chromium)                                 | e.g. `chrome` to use the installed Chrome; CI runs `playwright install chromium` |
| `E2E_VERBOSE=1`                         | unset                                                    | Echo API / worker / web / admin logs                                             |
| `E2E_{WEB,API,ADMIN,GATEWAY,SMTP}_PORT` | 4100 / 4101 / 4102 / 4103 / 4104                         | Ports (never 3000/3001/5173, so a dev stack can run alongside)                   |

First run: `pnpm --filter @repo/e2e exec playwright install chromium` (or set `E2E_BROWSER_CHANNEL=chrome`).
`pnpm e2e` rebuilds `apps/client/.next` and `apps/admin/dist-e2e` (gitignored) with the e2e origins.

## How the stack boots (`scripts/run.ts`)

1. Creates database `e2e_<random>`, `prisma migrate deploy`, `pnpm db:seed`, then
   `scripts/seed-extra.ts` (SQL): a default address for the demo customer and a customer
   `applicant@example.com` with a PENDING vendor application.
2. Builds API + worker (turbo), storefront (`next build`) and admin (`vite build --outDir dist-e2e`)
   with `NEXT_PUBLIC_API_URL` / `VITE_API_URL` = the e2e API origin.
3. Starts: API (`node server/dist/main.js`), worker (`node workers/jobs/dist/main.js`),
   `next start`, `vite preview`, a **fake payment gateway page** and an **SMTP sink**
   (`scripts/stubs.ts`) — nothing talks to a real third party.
4. Mints refresh-token sessions for the seeded users, runs `playwright test`, tears everything
   down (process groups, database, Redis DB 13).

No `webServer` in `playwright.config.ts`: the DB must exist and be seeded before the API starts.

## Auth without OAuth (and without a login endpoint)

`server/test/e2e/mint-sessions.ts` (run via `pnpm --filter @server/api e2e:mint-sessions`) builds
the API's real `TokenService` and calls `startSession(userId)` for each seeded user: a new refresh
family in Redis + a signed refresh JWT. The suite plants it as the `refresh_token` cookie
(`support/sessions.ts`: host `localhost`, path `/v1/auth`, HttpOnly, Secure, SameSite=Lax), and the
apps' normal boot-time `POST /v1/auth/refresh` signs the user in. A token is handed out once (a
refresh token cannot be shared by two browser contexts). No route was added to the API; the script
lives under `server/test/` (never in the build) and refuses `NODE_ENV=production`.

## Payments without a gateway

The worker is configured with VNPay test credentials whose pay URL points at the gateway stub, so
the **real** `createSession` runs (VNPay signing is local) and the browser is redirected to the stub.
The "gateway" then reports the payment through the **real** webhook route:
`support/vnpay.ts` builds the IPN with `buildSignData` / `hmacSha512` from `@repo/payments` and the
test secret (`support/config.ts` `SECRETS`) and calls `GET /v1/payments/webhook/vnpay`. No
test-only switch exists in the worker or API; a Stripe flow would be built the same way with
`stripe.webhooks.generateTestHeaderString`.

## Time

There is no fake clock. Flows move time by data: `support/db.ts` back-dates
`sub_orders.delivered_at` / `completed_at` and sets `platform_settings.hold_period_days = 0`, then
`support/jobs.ts` runs `node workers/jobs/dist/run-job.js <job>` once against the e2e database.

## Flows (`tests/`, serial, in file order, one worker, shared database)

| File                            | Flow                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `00-stack.spec.ts`              | Stack is up; a minted cookie signs the customer in                                            |
| `01-guest-cart.spec.ts`         | (a) guest browses home → category → product, adds to cart, signs in, cart merged              |
| `02-checkout-payment.spec.ts`   | (b) 2-vendor checkout → fake gateway → signed VNPay IPN → order PAID in "My orders"           |
| `03-fulfilment.spec.ts`         | (c) both vendor owners accept → ship → deliver in the admin portal; customer confirms receipt |
| `04-payout.spec.ts`             | (d) auto-complete + `release-payouts` → wallets grow by the exact net (209 100 / 105 100 VND) |
| `05-vendor-application.spec.ts` | (e) admin approves the seeded PENDING application → ACTIVE vendor + wallet + owner role       |

Flows depend on each other's data (`support/state.ts` keeps ids in a file next to the sessions).
Selectors are accessibility-based (`getByRole` / `getByLabel`), tests use the **English** UI
(`/en`, admin `localStorage['admin.locale'] = 'en'`). Reading ground truth / moving time with SQL is
fine; creating business state must go through the UI or real routes.

## Adding a flow

New spec file with the next number; reuse `signIn`, `query`/`one`, `runJob`, `sendVnpayIpn`. If it
needs seed rows, add them to `scripts/seed-extra.ts` (fixed ids, `ON CONFLICT DO NOTHING`). A flow
that cannot be made reliable stays `test.fixme('reason')` — never a fake pass.

## Commands

```bash
pnpm --filter @repo/e2e typecheck
pnpm --filter @repo/e2e lint
```
