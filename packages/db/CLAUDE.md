# @repo/db

Prisma schema (DB source of truth), client singleton, ledger helpers, seed.

## State

- Schema: 27 models, 15 enums (identity, vendor/KYC, catalog+i18n, cart, orders, payment+ledger, coupons, reviews, settings, outbox).
- Migrations: `init`, `add_search_indexes` (pg_trgm + tsvector, hand-written SQL), `register_search_vector` (registers the generated `search_vector` column via `Unsupported("tsvector")`).
- Client: singleton in `src/client.ts`, exported as `prisma` from `src/index.ts`. NEVER export the `PrismaClient` constructor outside this package.
- IDs: ULID supplied at create-time (no DB default). Use `ulid()` from the `ulid` package.
- Money: paired `*_amount Int` + `*_currency Currency`. Never float.

## ⚠️ Search-index drift (read before running migrate dev)

The full-text/trigram indexes (`product_translations_search_vector_idx`,
`product_translations_name_trgm_idx`, `category_translations_name_trgm_idx`) and the
`search_vector` generated column are created by hand-written SQL in the `add_search_indexes`
migration. Prisma's `@@index` cannot express `USING GIN`, so `prisma migrate dev` /
`--create-only` will DETECT DRIFT and try to generate a migration that DROPS these indexes.
**Never apply/confirm a generated migration that drops `search_vector` or the GIN indexes.**
Add new search SQL as a new hand-written migration instead. `prisma migrate deploy` (prod path,
no shadow diff) is unaffected.

## Commands

- `pnpm --filter @repo/db migrate` — migrate dev
- `pnpm --filter @repo/db seed` — idempotent seed
- `pnpm --filter @repo/db test` — vitest (needs local postgres via `pnpm services:up`)
