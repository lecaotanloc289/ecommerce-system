# @repo/db

Prisma schema (DB source of truth), client singleton, ledger + money boundary helpers, seed.

## State

- Schema: 29 models, 16 enums (identity, vendor/KYC + staff invitations, catalog+i18n, cart, orders, payment+ledger+refunds, coupons, reviews, settings, outbox).
- Migrations: `init`, `add_search_indexes` (pg_trgm + tsvector, hand-written SQL), `register_search_vector` (registers the generated `search_vector` column via `Unsupported("tsvector")`), `add_platform_coupon_code_unique` (partial unique index so platform coupons — `vendor_id IS NULL` — have globally-unique codes; Prisma's `@@unique` can't express a `WHERE` clause), `widen_money_columns_to_bigint` (every money column int4 → int8; hand-edited to strip the search-index drift statements below), `add_marketplace_ops_fields` (roadmap T0.1 — every column/table later waves need; hand-edited for the same drift, plus the hand-written partial unique index `refunds_sub_order_id_active_key`).
- Ops fields (roadmap D2/D7/D8/D11/D12/D14 — `docs/superpowers/plans/2026-11-23-marketplace-roadmap.md`):
  - `Payment.redirectUrl` / `expiresAt` — written by the worker after `createSession`; null until the session exists. `Order.paymentDeadlineAt` + `PlatformSettings.paymentTimeoutMinutes` (default 30) drive payment expiry.
  - `SubOrder.discountAmount` = **vendor-funded** discount (VENDOR coupons, lowers the commission base); `SubOrder.platformDiscountAmount` = this sub-order's share of PLATFORM coupons (platform-funded, never lowers vendor net or commission). Fulfilment: `carrier`, `trackingNumber`, `shippedAt`, `deliveredAt`, `cancelledAt` (+ existing `completedAt`).
  - Moderation: `ProductStatus.BLOCKED` + `Product.blockedReason`; `Vendor.suspendedReason`.
  - `OutboxEvent.nextAttemptAt` (default now) — dispatcher polls `processed_at IS NULL AND next_attempt_at <= now()`, index `(processed_at, next_attempt_at)` (replaced the `processed_at`-only index).
  - `Refund` (`refunds`, `RefundStatus` PENDING/SUCCEEDED/FAILED): full refund of one sub-order. DB allows **at most one non-FAILED refund per sub-order** (partial unique index → Prisma `P2002`); a FAILED one may be retried. FKs to sub-order/payment/user are `Restrict` (money history).
  - `VendorInvitation` (`vendor_invitations`): store `email` lowercase and only the token **hash** (`tokenHash` unique); cascades with the vendor.
- Client: singleton in `src/client.ts`, exported as `prisma` from `src/index.ts`. NEVER export the `PrismaClient` constructor outside this package.
- IDs: ULID supplied at create-time (no DB default). Use `ulid()` from the `ulid` package. Seed rows use the fixed canonical ULIDs in `src/seed-ids.ts` (`01SEED…`), so they parse through `@repo/core` id schemas. A local DB seeded before these ids existed (`vendor_a`, …) needs `pnpm db:reset` — the new seed collides on unique slugs/emails.
- Seed demo data (all VND, emails lowercase, tests may reference `SEED_IDS`): users `customer@example.com` (CUSTOMER, `demoUser`), `admin@example.com` (PLATFORM_ADMIN, `adminUser`), `vendor-a@example.com` / `vendor-b@example.com` (VENDOR_OWNER); ACTIVE vendors `vendor-a` / `vendor-b`, each with a zero-balance Wallet; shipping methods A Standard 30 000 / 3d, A Express 50 000 / 1d, B Standard 25 000 / 4d; categories `thoi-trang`/`apparel` and `nha-cua`/`home-living` under an untranslated root; ACTIVE products (vi + en) `basic-tee` (A, SKU `TEE-BLK-M`), `straight-jeans` (A, `JEAN-BLU-30`, `JEAN-BLU-32`), `white-ceramic-mug` (B, `MUG-WHT-350`), `scented-candle` (B, `CANDLE-LAV`); coupons `WELCOME10` (PLATFORM, PERCENT 1000 bps, min spend 100 000, 1 per user) and `VENDORA5` (VENDOR A, PERCENT 500 bps), valid 2026-01-01 → 2030-12-31. Products and variants are upserted one by one, so new seed rows also reach an older seeded DB.
- Money: paired `*_amount BigInt` + `*_currency Currency` (or a row-level `currency`). Never float. Prisma returns `bigint`; convert at the repository boundary with `toMoney(amount, currency)` → `@repo/core` Money (throws `money.error.overflow` beyond 2^53 − 1) and `toDbAmount(money)` → `bigint`, both exported from `src/money.ts`. bps, percents, counts and quantities stay `Int`. `Coupon.discountValue` is BigInt because it can hold a FIXED amount: pass it through `toMoney` only when `discountType = FIXED` (and `currency` is set). For `PERCENT` it is not money: it is **basis points** (1000 = 10%, valid range 1–10000, decided 2026-11-19 to match `commission_bps`) — compute the discount with `@repo/core` `applyBps(subtotal, Number(discountValue), rounding)`.
- Never `JSON.stringify` a raw Prisma row: `bigint` throws ("Do not know how to serialize a BigInt"). Map amounts with `toMoney` before building DTOs, API responses or `OutboxEvent.payload`.

## ⚠️ Search-index drift (read before running migrate dev)

The full-text/trigram indexes (`product_translations_search_vector_idx`,
`product_translations_name_trgm_idx`, `category_translations_name_trgm_idx`) and the
`search_vector` generated column are created by hand-written SQL in the `add_search_indexes`
migration. Prisma's `@@index` cannot express `USING GIN`, so `prisma migrate dev` /
`--create-only` will DETECT DRIFT and try to generate a migration that DROPS these indexes.
**Never apply/confirm a generated migration that drops `search_vector` or the GIN indexes.**
The same applies to the partial unique indexes `coupons_platform_code_key` and
`refunds_sub_order_id_active_key` (they have a `WHERE` clause Prisma can't model) — never confirm a
migration that drops them. Safe workflow: `migrate dev --create-only --name …`, delete the drift
statements from the generated SQL, then apply with `prisma migrate deploy`. Check with
`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --script`:
the only expected output is the three search-index drops + `search_vector DROP DEFAULT`.
Add new search/partial-index SQL as a new hand-written migration instead. `prisma migrate deploy`
(prod path, no shadow diff) is unaffected.

## Commands

- `pnpm --filter @repo/db migrate` — migrate dev
- `pnpm --filter @repo/db seed` — idempotent seed
- `pnpm --filter @repo/db test` — vitest: seed idempotency + demo-data shape, ledger invariant, money boundary, ops-schema checks in rolled-back transactions (needs local postgres via `pnpm services:up`; `@repo/core` must be built first — `pnpm --filter @repo/core build`, or run through turbo `pnpm test`, which builds deps)
- `pnpm --filter @repo/db typecheck` — `tsc` for `src/` and `test/` (`test/tsconfig.json`); also needs `@repo/core` built
