# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Mission

Build a **multi-vendor marketplace** with international reach (vi + en, VND + USD), with three clearly separated actors:

- **Customer** — browses, orders, and pays through the platform.
- **Vendor** — a regular user who applies to sell; only ACTIVE after admin approval. Manages their own products, sub-orders, and payouts.
- **Platform** — approves vendors, runs the marketplace, holds escrow, charges commission, releases payouts to vendors after the hold period.

A single order may contain products from multiple vendors → the backend automatically splits it into **sub-orders per vendor** inside one DB transaction. Funds flow through the **platform's escrow**; only after a sub-order is COMPLETED and the hold period has elapsed are funds released to the vendor (minus commission).

This file is the **constitution**. Every PR must respect the Golden Rules and NEVER DO list. Any deviation must be justified in the PR description and the file updated accordingly.

### Implementation status (as of 2026-05-20)

Skeleton complete: workspace topology (`apps/*`, `server/*`, `packages/*`), Turbo build pipeline, lint/format/CI, `docker-compose` for local services, placeholder `package.json` + `tsconfig.json` per workspace. **No real code yet** — every workspace has a stub `src/index.ts` and `dev`/`build`/`test` scripts that print `echo 'TODO: ...'`. Real implementation starts once the open business numbers (commission %, hold period, refund window, KYC docs, idempotency TTL) are locked. See the `project-open-business-decisions` memory entry.

---

## 2. Tech stack (detailed)

**Monorepo**

- pnpm workspaces + Turborepo (cache + pipeline `build → typecheck → lint → test`)

**Web — `apps/web` (storefront, public)**

- Next.js 15 App Router, React 19, Server Components by default
- Tailwind v4, shadcn/ui imported from `@repo/ui`
- `next-intl` for i18n (vi/en), route prefix `/vi`, `/en`
- TanStack Query for client cache (prefer Server Actions / RSC fetch for reads)
- `react-hook-form` + `@hookform/resolvers/zod` for forms (schemas from `@repo/core`)
- API calls go through `@repo/sdk` (typed)

**Admin — `apps/admin` (platform admin + vendor dashboard)**

- Vite 6 + React 19 + React Router 7
- TanStack Query (server state), Zustand (UI/local state — modals, filter drafts)
- Tailwind v4, shadcn/ui from `@repo/ui` (shared)
- Role-based routing: `/platform/*` (PLATFORM_ADMIN, PLATFORM_STAFF), `/vendor/*` (VENDOR_OWNER, VENDOR_STAFF)

**API — `server/` (package `@server/api`)**

- NestJS 11 + Fastify adapter, prefix `/v1`
- `nestjs-zod` pipe (validation from schemas in `@repo/core`)
- Auth: `@nestjs/passport` + `passport-google-oauth20` + `passport-facebook` + `@nestjs/jwt`
- Logger: `nestjs-pino`
- Security: `@fastify/helmet`, `@fastify/cors` (credentials true), `@fastify/cookie`
- OpenAPI: `@nestjs/swagger` → generates the client used by `@repo/sdk`
- Queue: BullMQ (Redis) for the outbox worker, payout scheduler, email sender

**Database**

- PostgreSQL 18, Prisma 6
- `pg_trgm` + `tsvector` for product search; JSONB for variant attributes
- Prisma Client is a **singleton** inside `packages/db` and never exposed outside it
- Migrations: `prisma migrate dev` (local), `prisma migrate deploy` (prod). **Forward-only**

**Cache, Queue, Storage**

- Redis 7: session denylist, rate limiting, BullMQ
- S3-compatible storage: R2 (prod) or MinIO (local docker) for product images and KYC documents

**Payment**

- VNPay (VN domestic), Stripe (international). Separated via a `PaymentProvider` interface in `packages/payments`. Webhook handlers in `server/` verify signatures and write to outbox.

**Quality gates**

- ESLint flat config (`@repo/config/eslint`), Prettier, `lint-staged`, `husky`, `commitlint` (Conventional Commits)
- CI: GitHub Actions running `lint → typecheck → test → build`

---

## 3. Monorepo map

```
ecommerce-system/
├── apps/                          User-facing UI surfaces
│   ├── web/                       Next.js 15 storefront (customer-facing, i18n vi/en, public)
│   └── admin/                     Vite + React dashboard (platform admin + vendor portal)
├── server/                        Backend API (NestJS + Fastify), single workspace, package `@server/api`.
│                                   Versioned /v1, OpenAPI exposed. Code in `server/src/`.
│                                   Future async workers (outbox dispatcher, payout cron, email sender)
│                                   live OUTSIDE this workspace — likely a sibling top-level dir like
│                                   `workers/<name>/` if/when added.
├── packages/                      Shared libraries
│   ├── core/                      Domain layer: Zod schemas, types (z.infer), enums, error codes,
│   │                              Money utility, ID brands, shared constants.
│   │                              MUST NOT import from apps/* or server/*.
│   ├── ui/                        shadcn/ui components + Tailwind preset. Used by web + admin.
│   │                              Pure components: no API calls, no awareness of auth.
│   ├── db/                        Prisma schema (DB source of truth), client singleton, seed,
│   │                              migrations. Repository layer lives here or in server/src/*.repository.ts
│   ├── sdk/                       Typed API client (generated from OpenAPI via openapi-typescript / orval).
│   │                              Re-exports Zod response schemas so web/admin can parse responses.
│   ├── payments/                  PaymentProvider interface + VNPay / Stripe adapters.
│   │                              Pure logic, no DB access; injected into `server/` services.
│   ├── i18n/                      Messages vi/en (JSON), formatters (currency, date, plural).
│   │                              Follows next-intl conventions, shared between web and admin.
│   └── config/                    Shared ESLint / TS / Tailwind / Prettier / commitlint configs.
├── docker-compose.yml + docker/   Local Postgres + Redis + MinIO + Mailhog
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example                   (NEVER commit real .env)
└── CLAUDE.md                      (this file)
```

**Dependency rules:**

```
apps/*      → packages/*           (OK)
server      → packages/*           (OK)
packages/*  → packages/*           (OK, in dependency direction: core → ui/i18n/db/sdk/payments; no cycles)
apps/*      ↔ apps/*               (FORBIDDEN — share via packages/*)
apps/*      ↔ server               (FORBIDDEN — frontends call HTTP via @repo/sdk)
packages/*  → apps/* | server      (FORBIDDEN — packages don't depend on consumers)
```

---

## 4. Data flow (Web → Server → DB)

Worked example: **a customer checks out a cart containing items from 2 vendors** (representative of any mutation).

```
[Browser]
   │  1. User clicks Checkout. UI validates the form with CheckoutSchema (packages/core).
   ▼
[apps/web RSC / Server Action]
   │  2. Server Action calls sdk.orders.checkout(payload) — typed, already schema-conformant.
   │     Headers: Authorization: Bearer <accessJwt>, Idempotency-Key: <ulid>
   ▼
[server  POST /v1/orders/checkout]
   │  3. Middleware: helmet, cors(credentials), rate-limit, request-id (pino).
   │  4. JwtAuthGuard → verifies access token → req.user = { id, roles, vendorId? }
   │  5. RolesGuard @Roles('CUSTOMER') → allow
   │  6. ZodValidationPipe → parses body against CheckoutSchema; reject 422 on failure.
   │  7. OrdersController.checkout → OrdersService.checkoutCart(userId, dto, idemKey)
   ▼
[OrdersService — orchestration]
   │  8. Idempotency check via Redis (idemKey → existing orderId if already processed).
   │  9. Open a Prisma $transaction:
   │       a. Lock + reserve inventory (UPDATE ... WHERE stock >= qty)
   │       b. Group items by vendorId
   │       c. INSERT Order (parent) + N SubOrder (one per vendor) + OrderItems
   │       d. INSERT LedgerEntry (escrow IN from customer)
   │       e. INSERT OutboxEvent rows (order.created, payment.requested)
   │  10. Commit. Return Order DTO (parsed through a Zod response schema).
   ▼
[Worker (BullMQ)]
   │  11. Consume outbox: send a payment request via the VNPay/Stripe adapter (packages/payments).
   │  12. Gateway returns a redirect URL → API → web → browser redirects user.
   ▼
[Payment gateway]
   │  13. User pays → gateway POSTs to /v1/payments/webhook/:provider.
   │  14. API verifies signature, writes LedgerEntry (payment CONFIRMED), updates SubOrder status.
   │  15. Outbox: order.paid → notify customer + vendors (email/Zalo).
   ▼
[Hold period elapses (cron / scheduler)]
   │  16. Job scans SubOrders that are COMPLETED past the hold window
   │      → computes payout = subtotal − commission.
   │  17. Writes LedgerEntry (escrow OUT → vendor wallet); outbox payout.requested.
```

**Principles enforced by this flow:**

- **One schema, three usages:** form (web) — pipe (api) — type (sdk). All three reference `packages/core`.
- **Multi-write is always inside `$transaction`** (order + sub-orders + inventory + ledger + outbox).
- **Side effects go through the Outbox**, never directly in the request thread.

---

## 5. Golden Rules (10)

1. **One Zod schema, one source of truth.** All shapes (request, response, DB DTO, form) are defined in `packages/core/schemas/*`. Types are derived via `z.infer`. Do NOT write duplicate interfaces.

2. **Money is an integer in the smallest unit.** VND is stored as integer (đồng), USD as cents. All operations go through the `Money` utility in `packages/core/money`. NEVER use floating-point numbers for money.

3. **Every mutation is idempotent.** Clients send an `Idempotency-Key` (ULID) for POST/PUT/PATCH; the server checks Redis before processing. Mandatory for `/orders/checkout` and `/payments/*`.

4. **Order is the aggregate root, split per vendor inside one transaction.** A multi-vendor cart yields N sub-orders inside a single `prisma.$transaction`. Inventory reservation is atomic (`UPDATE ... WHERE stock >= qty`).

5. **OAuth only.** No email/password endpoint. Access JWT lasts 15m (kept in memory), refresh token 30d (HttpOnly + Secure + SameSite=Lax cookie), rotated on every refresh, revoked on logout. MVP providers: Google + Facebook.

6. **Authorization by role + ownership.** Every protected endpoint declares `@Roles(...)`. Vendor queries always filter by `vendorId = req.user.vendorId` in the service layer — NEVER trust a client-supplied vendorId.

7. **i18n is required from day one.** All user-facing text goes through `packages/i18n` (vi/en). API responses carry `errorCode` + `params`; the frontend translates. Do NOT hardcode strings in components or API responses.

8. **Migrations are forward-only and reviewed.** Created with `pnpm db:migrate dev`. Never edit an applied migration. Destructive changes (drop column, rename) require a 2-phase migration: ship code that reads both → migrate → cleanup migration.

9. **Side effects go through the Outbox.** Email, webhooks, payouts, notifications — write to `outbox_events` inside the same transaction as the business change; a BullMQ worker dispatches them. Do NOT `await externalApi()` in the request thread.

10. **CI gate must pass.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must be green before merge. The pre-commit hook runs `lint-staged` + `typecheck` on changed files.

---

## 6. NEVER DO (anti-patterns)

- **Do not use `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`.** If the type is hard, parse via Zod or write a type guard.
- **Do not import across workspaces** (`apps/web` ↔ `apps/admin`, `apps/*` ↔ `server`). Share via `packages/*`.
- **Do not let Prisma Client leak outside `packages/db`.** Controllers, services, and components must not import `PrismaClient` directly — only `PrismaService` injected into the `server` workspace.
- **Do not roll your own auth flow.** OAuth uses Passport strategies; JWT uses `@nestjs/jwt`. Do not verify signatures manually.
- **Do not store refresh tokens or sensitive data in `localStorage`/`sessionStorage`.** Refresh tokens go in HttpOnly cookies. Access tokens stay in memory (TanStack Query / a non-persisted Zustand slice).
- **Do not put business logic in controllers.** Controllers orchestrate: request → guard → pipe → service. Logic lives in services/domain.
- **Do not hardcode price, currency, FX rate, or commission %.** Read from DB (`PlatformSettings`) or env, format via `Money` + `@repo/i18n`.
- **Do not skip transactions for multi-write operations.** Order creation, payouts, inventory moves — always `$transaction`.
- **Do not trust client-supplied `vendorId`, `userId`, `role`, or `price`.** Take these from `req.user` or re-query the DB.
- **Do not `console.log` in production code.** API uses `pino`; web/admin use a dev-only logger wrapper.
- **Do not commit `.env*`, `*.pem`, keys, tokens, or KYC files.** Only commit `.env.example`.
- **Do not use floats for money** (see Golden Rule #2).
- **Do not `await externalApi()` in the request thread** — use the Outbox + worker (Golden Rule #9).
- **Do not build generic CRUD endpoints.** Endpoints reflect business use cases (`POST /vendor-applications/:id/approve`, not `PATCH /vendors/:id` with `{status: 'ACTIVE'}`).
- **Do not put secrets in the client bundle.** Anything `NEXT_PUBLIC_*` / `VITE_*` is **public** — treat it as leaked.

---

## 7. Naming conventions

| Scope               | Convention                                                      | Example                                                 |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| File                | kebab-case                                                      | `product-card.tsx`, `vendor-payout.service.ts`          |
| React component     | PascalCase export                                               | `export function ProductCard()`                         |
| React hook          | `useXxx`                                                        | `useCartQuery`, `useCurrentVendor`                      |
| Zod schema          | `XxxSchema`                                                     | `CheckoutSchema`, `VendorApplicationSchema`             |
| Type from schema    | `Xxx = z.infer<typeof XxxSchema>`                               | `type Checkout = z.infer<typeof CheckoutSchema>`        |
| NestJS class        | `XxxController` / `XxxService` / `XxxModule` / `XxxRepository`  | `OrdersService`                                         |
| Prisma model        | PascalCase, **singular**                                        | `Product`, `Order`, `OrderItem`, `SubOrder`             |
| DB table (physical) | snake_case, **plural** via `@@map`                              | `@@map("order_items")`                                  |
| Enum (Prisma + TS)  | SCREAMING_SNAKE_CASE values                                     | `OrderStatus.AWAITING_PAYMENT`                          |
| API route           | kebab-case, plural noun, versioned                              | `POST /v1/vendor-applications`                          |
| Env var             | SCREAMING_SNAKE_CASE                                            | `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`                |
| i18n key            | dot.namespaced kebab                                            | `checkout.error.out-of-stock`                           |
| Branch              | `feat/`, `fix/`, `chore/`, `refactor/`                          | `feat/vendor-payout-cron`                               |
| Commit              | Conventional Commits                                            | `feat(orders): split multi-vendor cart into sub-orders` |
| Workspace package   | `@apps/<n>` (UI), `@server/<n>` (backend), `@repo/<n>` (shared) | `@apps/web`, `@server/api`, `@repo/core`                |
| ID                  | ULID (text), brand type per entity                              | `type OrderId = Brand<string, 'OrderId'>`               |
| Boolean             | `is/has/can/should` prefix                                      | `isActive`, `hasShipped`, `canRefund`                   |
| Money field         | suffix `_amount` + `_currency`                                  | `subtotal_amount`, `subtotal_currency`                  |

---

## 8. AI CODING BEHAVIOR

### Read Before Code

- Read target file + files that import/export from it.
- Read local `CLAUDE.md` + `MEMORY.md` in the target package.
- If editing a function, grep all callers before changing signature.

### Think → Simplify → Surgery

- **Think:** State assumptions. If multiple interpretations, present them — don't pick silently. If unclear, ask.
- **Simplify:** No features beyond what was asked. No speculative abstractions. If 200 lines could be 50, rewrite.
- **Surgery:** Touch only what's needed. Match existing style. Remove only orphans YOUR changes created. Every changed line must trace to the request.

### Verify

For multi-step tasks, state a plan with checks:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Example:

```
1. Add coupon_redemption table         → verify: pnpm db:migrate dev; schema diff matches
2. Wire applyCoupon() in checkout svc  → verify: unit tests (valid + expired + max-use) pass
3. Render coupon input on cart page    → verify: e2e checkout-with-coupon flow green
```

Verification must produce **evidence** (command output, test result, screenshot). Never claim "done" / "fixed" / "passing" from inference alone.

---

## 9. Database migration

**Workflow**

- Develop: `pnpm db:migrate dev --name <kebab-case-description>` (generates SQL + applies to local DB).
- Review: the PR diff must include the new SQL file under `packages/db/prisma/migrations/`.
- Deploy: `pnpm db:migrate deploy` (CI/CD, no regeneration, idempotent).
- Reset local: `pnpm db:reset` (drop + reapply + seed) — local only.

**Naming**

- Folder: `YYYYMMDDHHMMSS_kebab-case-description` (Prisma default).
- Description starts with a verb: `add_coupon_table`, `backfill_vendor_status`, `drop_legacy_price_column`.

**Destructive changes are two-phase**
Never rename or drop in a single migration:

1. **Migration A** — add the new column/table; ship app code that writes to both new + old and reads from either.
2. **Migration B** — once old data is fully migrated and read traffic uses the new path, drop the old. Ship in a later release.

**Seed data**

- `packages/db/src/seed.ts` — idempotent: roles, `PlatformSettings`, demo users, sample vendors/products/categories, sample coupons.
- Runs via `pnpm db:seed`. Used by local dev and CI integration tests. NEVER run against production.

**Shadow database**

- Prisma uses an automatic shadow DB during `migrate dev` to detect drift. Do not disable it.

**Tunables live in DB, not in enums**

- `commission_bps`, `hold_period_days`, `refund_window_days`, `max_coupon_stack` belong in the `PlatformSettings` table so they can be tuned without redeploying. Never bake them into TypeScript enums or migration constants.

**Forbidden**

- Editing a migration that has been merged (open a new one instead).
- Hand-written SQL outside migration files for schema changes.
- Skipping the shadow DB or running `prisma db push` against any environment other than a throwaway local one.

---

## 10. Testing

**Pyramid**

- **Unit (Vitest, per `packages/*`):** pure functions, schema validation, Money math, payment adapter logic with mocked HTTP. Fast (<1s per file).
- **Integration (Jest, in `server/`):** services that hit DB via Testcontainers (Postgres + Redis). Covers transaction rollback, idempotency replay, outbox publishing, role + ownership guards.
- **E2E (Playwright, in `apps/web` and `apps/admin`):** smoke flows only — OAuth sign-in (mocked provider), browse → add to cart → checkout, vendor apply → admin approve → vendor lists a product.

**What to test**

- Every Zod schema: at least 1 valid + 1 invalid case.
- Every NestJS guard / pipe / interceptor.
- `Money`: zero, negative, currency mismatch, rounding boundaries.
- Order checkout: single-vendor, multi-vendor split, out-of-stock, idempotency replay, coupon stacking.
- Payout: hold-period boundary, refund reverses the ledger, commission math correctness.
- OAuth callback: new user (auto-create), returning user, account linking by verified email.

**What NOT to test**

- Prisma itself, NestJS framework code, third-party libraries.
- Trivial getters/setters.
- UI snapshots (brittle — prefer accessibility-based queries).

**Running**

- All: `pnpm test`
- One workspace: `pnpm --filter @repo/core test`
- Single file: `pnpm --filter @server/api test -- order.service.spec.ts`
- Watch mode: append `-- --watch`
- E2E headed: `pnpm --filter @apps/web e2e -- --headed`

**Coverage**

- No strict %, but reviewers reject PRs that add a service with zero tests.
- Branch coverage focus: order, payment, payout, coupon, refund — wherever money flows.

---

## 11. Business domain

### Actors and roles

| Role             | Owns                                                      | Can do                                                                                                                |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GUEST`          | nothing                                                   | Browse, search, view product, view category, view vendor page, manage a guest cart in `localStorage`                  |
| `CUSTOMER`       | `User`, `Address[]`, `Cart`, `Order[]`                    | All of GUEST + checkout, manage addresses, apply coupons, view order history, write reviews, apply to become a vendor |
| `VENDOR_OWNER`   | `Vendor` + products + sub-orders + payouts of that vendor | Manage own catalog, fulfill sub-orders, view payouts, invite `VENDOR_STAFF`                                           |
| `VENDOR_STAFF`   | scoped to vendor                                          | Subset of `VENDOR_OWNER`, no payout access                                                                            |
| `PLATFORM_STAFF` | global, mostly read                                       | Review vendor applications, moderate products, inspect orders/disputes                                                |
| `PLATFORM_ADMIN` | everything                                                | `PLATFORM_STAFF` + change platform settings, manage roles, issue refunds                                              |

### Where each role lives (workspace mapping)

| Role                               | Primary surface                     |
| ---------------------------------- | ----------------------------------- |
| `GUEST`, `CUSTOMER`                | `apps/web` (storefront)             |
| `VENDOR_OWNER`, `VENDOR_STAFF`     | `apps/admin` → `/vendor/*` routes   |
| `PLATFORM_STAFF`, `PLATFORM_ADMIN` | `apps/admin` → `/platform/*` routes |

`server/` (HTTP, package `@server/api`) serves all roles via REST; webhooks (payment, OAuth callback) terminate here. Future async workers (outbox dispatch, payout cron, email send) will live in a separate top-level dir (e.g. `workers/*`) — not nested inside `server/`.

### Customer journey (features in scope for MVP)

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
   - `Coupon`: `code` (unique), `scope` (`PLATFORM` or `VENDOR_ID`), `type` (`PERCENT` or `FIXED`), `value`, `min_subtotal_amount`, `max_redemptions_total`, `max_redemptions_per_user`, `starts_at`, `ends_at`, `is_active`.
   - `CouponRedemption` log enforces per-user and total caps **inside the checkout transaction**.
   - Stacking rule: at most 1 `PLATFORM` + 1 `VENDOR` coupon per sub-order; validated server-side.
   - Discounts apply **before** commission calc; commission is on the discounted subtotal.

10. **Payment methods.**
    At checkout the customer picks one provider:
    - **VNPay** (VND only): redirect flow → webhook confirms.
    - **Stripe** (USD, international): Payment Intents → 3DS as needed → webhook confirms.
    - **Wallet** (later): customer-funded wallet; checkout debits it.

    Payment provider applies to the **entire order**; escrow split into sub-order ledger entries happens after capture.

### Key entities (high-level — schema details live in `packages/db/prisma/schema.prisma`)

```
User ─── OAuthIdentity[]            (provider, providerUserId, emailVerified)
     ─── Address[]
     ─── Cart ─── CartItem[]
     ─── Order[]
     ─── Vendor?                    (only if application APPROVED)
     ─── Review[]

Vendor ─── Product[]
       ─── ShippingMethod[]
       ─── Wallet                   (balance from released escrow)
       ─── SubOrder[]
       ─── VendorApplication        (PENDING → APPROVED / REJECTED)

Product ─── ProductVariant[] ─── Inventory   (per warehouse if needed)
        ─── ProductImage[]
        ─── Category[]               (m2m via product_categories)

Category ─── parent? + Category[]    (self-referential tree)
         ─── CategoryTranslation[]   (locale → name, slug)

Order (parent, customer-facing)
  ├── SubOrder[]                     (one per vendor)
  │     ├── OrderItem[]              (price + title snapshot at checkout)
  │     ├── ShippingMethod (chosen)
  │     ├── ShippingAddress          (snapshot of Address at checkout)
  │     ├── CouponRedemption[]       (vendor-scoped coupons)
  │     └── status: AWAITING_PAYMENT → PAID → PROCESSING → SHIPPED
  │                  → DELIVERED → COMPLETED / REFUNDED / CANCELLED
  ├── CouponRedemption[]             (platform-scoped coupons)
  ├── Payment[]                      (one row per attempt; latest = current)
  └── LedgerEntry[]                  (escrow IN, payout OUT, refund, fees)

PlatformSettings (singleton row)
  commission_bps, hold_period_days, refund_window_days, supported_currencies, ...

OutboxEvent
  aggregate_id, event_type, payload (JSONB), created_at, processed_at?
```

**Snapshot rule:** product price/title and shipping address are **copied into `OrderItem` / `SubOrder`** at checkout. Later edits to the underlying `Product` or `Address` must never alter historical orders.

---

## 12. Memory protocol

Claude Code keeps persistent memory in `~/.claude/projects/.../memory/`. Use it for context **not derivable from code**.

**Save (4 types):**

- `user` — the user's role, preferences, domain expertise.
- `feedback` — rules learned from a correction or a validated decision; include **Why** and **How to apply**.
- `project` — business decisions not yet in code (commission %, hold-period days, vendor KYC requirements, sprint goals, owners, deadlines). Convert relative dates to absolute.
- `reference` — pointers to external systems (Linear board, Notion doc, Figma file, Grafana dashboard).

**Do NOT save:**

- Code patterns / conventions (already in CLAUDE.md or the code).
- Git history, blame, recent diffs.
- Bug-fix recipes (the fix lives in the commit message).
- Transient task state (use Todos, not memory).

**Before recommending from memory:**

- If memory claims "file X has function Y" → `grep` / `Read` to verify it still exists.
- If memory is a snapshot of repo state → prefer `git log` / current code; update or delete the stale memory.

**Workflow:**

1. At session start, read `MEMORY.md` (the index).
2. When the user shares new context → write it to its own memory file and add a one-liner to `MEMORY.md`.
3. When memory contradicts current code → trust the code, then fix the memory.
4. Link related memories with `[[slug]]` references.

---

## 13. Common commands

### Dev (start dev servers)

```bash
pnpm dev                            # all workspaces in parallel via Turbo
pnpm --filter @apps/web dev         # storefront only       → http://localhost:3000
pnpm --filter @apps/admin dev       # admin only            → http://localhost:5173
pnpm --filter @server/api dev       # API only              → http://localhost:3001
```

### Build / lint / typecheck / test

```bash
pnpm build                          # all
pnpm lint                           # all
pnpm typecheck                      # all
pnpm test                           # all (unit + integration)

pnpm --filter @repo/core test                                # one workspace
pnpm --filter @server/api test -- order.service.spec.ts      # one test file
pnpm --filter @server/api test -- --watch                    # watch mode
pnpm --filter @apps/web e2e -- --headed                      # Playwright headed
```

### Database (Prisma, via `@repo/db`)

```bash
pnpm db:generate                    # regenerate Prisma Client
pnpm db:migrate                     # migrate dev — creates a new migration
pnpm db:reset                       # drop + reapply + seed   — LOCAL ONLY
pnpm db:seed                        # idempotent seed (PlatformSettings, demo data)
```

### Local services (docker compose)

```bash
pnpm services:up                    # postgres + redis + minio + mailhog
pnpm services:down
pnpm services:logs
```

### Ports

| Service       | Port        | Notes                                     |
| ------------- | ----------- | ----------------------------------------- |
| `@apps/web`   | 3000        | Next.js storefront                        |
| `@server/api` | 3001        | NestJS + Fastify, prefix `/v1`            |
| `@apps/admin` | 5173        | Vite dev server                           |
| Postgres      | 5432        | DBs: `ecommerce`, `ecommerce_shadow`      |
| Redis         | 6379        | Cache + BullMQ                            |
| MinIO         | 9000 / 9001 | S3 API / web console (`minioadmin`/`...`) |
| Mailhog       | 1025 / 8025 | SMTP / web UI                             |

### First-time setup

```bash
pnpm install
cp .env.example .env                # fill in OAuth client IDs, JWT secrets, etc.
pnpm services:up                    # spin up local infra
pnpm db:migrate                     # apply schema (once db package has it)
pnpm db:seed
pnpm dev                            # or filter to one workspace as above
```
