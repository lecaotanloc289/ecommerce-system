# @repo/core

Domain layer: Zod schemas + `z.infer` types, Money utility, branded IDs, enums, error catalog.
Pure TypeScript + `zod` — runs in browser and Node. Never imports `@repo/db`, `apps/*` or `server`.

## Layout

| Path            | Subpath export         | What                                                                                               |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `src/money/`    | `@repo/core/money`     | `of`, `zero`, `add`, `subtract`, `sum`, `multiply`, `applyBps`, `allocate`, `compare`, `equals`, … |
| `src/ids/`      | `@repo/core/ids`       | `Brand<T, Name>`, `UlidSchema`, `XxxIdSchema` / `XxxId` per entity, `IdempotencyKeySchema`         |
| `src/enums/`    | `@repo/core/enums`     | `XxxSchema` + `Xxx` (type and value object, e.g. `Role.CUSTOMER`) mirroring every Prisma enum      |
| `src/errors/`   | `@repo/core/errors`    | `ERROR_CODES`, `ERROR_HTTP_STATUS`, `ErrorResponseSchema`, `DomainError`                           |
| `src/schemas/*` | `@repo/core/schemas/*` | `money`, `common`, `address`, `category`, `product`, `cart`, `checkout`                            |

The root export (`@repo/core`) re-exports everything; Money helpers are namespaced there:
`const m: Money = Money.of(150_000, 'VND')`. Every export (root and subpaths) resolves to `dist/`, built
by tsup with `splitting` so all entries share one copy of each module (`instanceof DomainError` works
whichever path it was imported from). Consumers need `@repo/core` built first (turbo `^build`).

## Rules specific to this package

- **Money:** integer minor units only. Arithmetic ops (`of`, `add`, `subtract`, `sum`, `multiply`,
  `applyBps`, `allocate`) validate safe integers and compute in BigInt; overflow throws
  `money.error.overflow`. `applyBps` has no default rounding — pick `floor` / `ceil` / `half-up` /
  `half-even` explicitly. `allocate` (largest-remainder) always sums back to the input.
- **Money ↔ DB:** the API shape is nested `{ amount, currency }`; DB columns are flat `xxxAmount` +
  `xxxCurrency` (or a row-level `currency`). The server's repository layer maps between them.
  ⚠️ Open issue: DB money columns are Prisma `Int` (int4, max 2,147,483,647) while `Money` allows up to
  2^53 − 1 — a VND total over ~2.1B đồng passes core but fails on insert. Needs a decision in `@repo/db`
  (move to `BigInt`) before checkout/wallet code ships.
- **Enums:** values must equal `packages/db/prisma/schema.prisma` exactly. `test/enums.test.ts` parses the
  schema file and fails if an enum is added, removed or changed on either side — update both together.
- **IDs:** canonical uppercase ULID (`ulid` package output). Non-ULID ids fail validation — the db seed's
  fixed ids (`vendor_a`, `product_a1`, …) do not pass `XxxIdSchema`.
- **Errors:** codes are i18n keys, `<domain>.error.<kebab>`. New code → add to `ERROR_CODES` and
  `ERROR_HTTP_STATUS` (the compiler enforces the second). No user-facing text in this package.
- **Schemas:** read shapes mirror DB nullability (`null`, not optional). Request schemas never carry
  `price`, `vendorId`, `userId` or `role` — the server re-reads them.

## Commands

- `pnpm --filter @repo/core typecheck` — `tsc` for `src/` and `test/` (tests have their own `test/tsconfig.json` with Node types)
- `pnpm --filter @repo/core test` — Vitest, no services needed
- `pnpm --filter @repo/core build` — tsup → `dist/` (ESM + CJS + d.ts)
