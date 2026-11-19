# @repo/db

Prisma schema (DB source of truth), client singleton, ledger + money boundary helpers, seed.

## State

- Schema: 27 models, 15 enums (identity, vendor/KYC, catalog+i18n, cart, orders, payment+ledger, coupons, reviews, settings, outbox).
- Migrations: `init`, `add_search_indexes` (pg_trgm + tsvector, hand-written SQL), `register_search_vector` (registers the generated `search_vector` column via `Unsupported("tsvector")`), `add_platform_coupon_code_unique` (partial unique index so platform coupons — `vendor_id IS NULL` — have globally-unique codes; Prisma's `@@unique` can't express a `WHERE` clause), `widen_money_columns_to_bigint` (every money column int4 → int8; hand-edited to strip the search-index drift statements below).
- Client: singleton in `src/client.ts`, exported as `prisma` from `src/index.ts`. NEVER export the `PrismaClient` constructor outside this package.
- IDs: ULID supplied at create-time (no DB default). Use `ulid()` from the `ulid` package. Seed rows use the fixed canonical ULIDs in `src/seed-ids.ts` (`01SEED…`), so they parse through `@repo/core` id schemas. A local DB seeded before these ids existed (`vendor_a`, …) needs `pnpm db:reset` — the new seed collides on unique slugs/emails.
- Money: paired `*_amount BigInt` + `*_currency Currency` (or a row-level `currency`). Never float. Prisma returns `bigint`; convert at the repository boundary with `toMoney(amount, currency)` → `@repo/core` Money (throws `money.error.overflow` beyond 2^53 − 1) and `toDbAmount(money)` → `bigint`, both exported from `src/money.ts`. bps, percents, counts and quantities stay `Int`. `Coupon.discountValue` is BigInt because it can hold a FIXED amount: pass it through `toMoney` only when `discountType = FIXED` (and `currency` is set). For `PERCENT` it is not money: it is **basis points** (1000 = 10%, valid range 1–10000, decided 2026-11-19 to match `commission_bps`) — compute the discount with `@repo/core` `applyBps(subtotal, Number(discountValue), rounding)`.
- Never `JSON.stringify` a raw Prisma row: `bigint` throws ("Do not know how to serialize a BigInt"). Map amounts with `toMoney` before building DTOs, API responses or `OutboxEvent.payload`.

## ⚠️ Search-index drift (read before running migrate dev)

The full-text/trigram indexes (`product_translations_search_vector_idx`,
`product_translations_name_trgm_idx`, `category_translations_name_trgm_idx`) and the
`search_vector` generated column are created by hand-written SQL in the `add_search_indexes`
migration. Prisma's `@@index` cannot express `USING GIN`, so `prisma migrate dev` /
`--create-only` will DETECT DRIFT and try to generate a migration that DROPS these indexes.
**Never apply/confirm a generated migration that drops `search_vector` or the GIN indexes.**
The same applies to the partial unique index `coupons_platform_code_key` (it has a `WHERE`
clause Prisma can't model) — `migrate dev` will also try to drop it; never confirm that.
Add new search/partial-index SQL as a new hand-written migration instead. `prisma migrate deploy`
(prod path, no shadow diff) is unaffected.

## Commands

- `pnpm --filter @repo/db migrate` — migrate dev
- `pnpm --filter @repo/db seed` — idempotent seed
- `pnpm --filter @repo/db test` — vitest (needs local postgres via `pnpm services:up`; `@repo/core` must be built first — `pnpm --filter @repo/core build`, or run through turbo `pnpm test`, which builds deps)
- `pnpm --filter @repo/db typecheck` — `tsc` for `src/` and `test/` (`test/tsconfig.json`); also needs `@repo/core` built
