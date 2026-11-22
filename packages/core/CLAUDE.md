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
| `src/schemas/*` | `@repo/core/schemas/*` | one file per area — see "Schemas" below                                                            |

The root export (`@repo/core`) re-exports everything; Money helpers are namespaced there:
`const m: Money = Money.of(150_000, 'VND')`. Every export (root and subpaths) resolves to `dist/`, built
by tsup with `splitting` so all entries share one copy of each module (`instanceof DomainError` works
whichever path it was imported from). Consumers need `@repo/core` built first (turbo `^build`).

## Schemas

Read shapes use Money, ISO-datetime strings and branded ids. Input shapes never carry `price`,
`vendorId`, `userId` or `role`. Each entry is `XxxSchema` + `Xxx` type.

- `money`, `common`: `Money`, `NonNegativeMoney`; `Slug`, `HttpUrl`. `datetime`: `IsoDateTime` (UTC ISO string on the wire).
- `address`: `AddressInput` (create), `AddressUpdate` (partial PATCH body), `AddressParams`, `Address`, `CountryCode`, `Phone`. `category`, `product`: `Category`, `CategoryTranslation`, `Product`, `ProductVariant`, `ProductImage`, `VariantAttributes`.
- `cart`, `checkout`: `CartLineInput`, `CartLine`, `Checkout`, `CouponCode`.
- `me`: `TokenResponse`, `MeResponse` (moved from the server), `ProfileUpdate`.
- `upload`: `UploadPurpose`, `UploadKey`, `PresignRequest`, `PresignResponse`. Clients send upload **keys**, never URLs (D13).
- `vendor`: `VendorPublic`, `VendorApplicationCreate`, `VendorApplication`, `VendorReject`.
- `order`: `Order`, `SubOrder`, `VendorSubOrder` (adds commission + net), `OrderItem`, `OrderSummary`, `ShippingAddressSnapshot`, `PaymentSession` (`redirectUrl` null until the worker creates the session), `SubOrderShip`.
- `shipping-method`: `ShippingMethod`, `ShippingMethodInput`.
- `coupon`: `CouponInput`, `Coupon` — a union on `discountType`: FIXED carries `discount: Money`, PERCENT carries `discountBps` (basis points, 1..10000). Scope comes from the endpoint, not the body.
- `review`: `ReviewCreate`, `Review`, `RatingSummary`.
- `platform-settings`: `PlatformSettingsPublic`, `PlatformSettings`, `PlatformSettingsUpdate` (partial, non-empty).
- `wallet`: `Wallet`, `LedgerEntry` (signed `amount`). `refund`: `RefundCreate` (whole sub-order, reason only), `Refund`.
- `vendor-invitation`: `VendorInvitationCreate` (email lowercased), `VendorInvitation`, `VendorInvitationAccept`.
- `product-admin`: `ProductUpsert` (both locales, variants, images by id-or-key, `categoryIds`), `VendorProductStatus` (no `BLOCKED`).

Known gaps: `VendorApplicationCreate` has no shop `displayName`/`slug` (the application table has no column
for them); there is no vendor-side read shape for raw translations/stock yet.

## Rules specific to this package

- **Money:** integer minor units only. Arithmetic ops (`of`, `add`, `subtract`, `sum`, `multiply`,
  `applyBps`, `allocate`) validate safe integers and compute in BigInt; overflow throws
  `money.error.overflow`. `applyBps` has no default rounding — pick `floor` / `ceil` / `half-up` /
  `half-even` explicitly. `allocate` (largest-remainder) always sums back to the input.
- **Money ↔ DB:** the API shape is nested `{ amount, currency }`; DB columns are flat `xxxAmount` +
  `xxxCurrency` (or a row-level `currency`). The server's repository layer maps between them.
  DB columns are `BigInt`; convert with `toMoney` / `toDbAmount` from `@repo/db`.
- **Enums:** values must equal `packages/db/prisma/schema.prisma` exactly. `test/enums.test.ts` parses the
  schema file and fails if an enum is added, removed or changed on either side — update both together.
- **IDs:** canonical uppercase ULID (`ulid` package output). Non-ULID ids fail validation (the db seed uses
  fixed canonical ULIDs for this reason).
- **Errors:** codes are i18n keys, `<domain>.error.<kebab>`. New code → add to `ERROR_CODES` and
  `ERROR_HTTP_STATUS` (the compiler enforces the second). No user-facing text in this package.
- **Pagination:** list endpoints use `PageQuerySchema` (`cursor?: ULID`, `limit` 1..100 default 20, coerced
  from query strings) and return `PageSchema(item)` = `{ items, nextCursor: ULID | null }` (`schemas/common.ts`).
- **Schemas:** read shapes mirror DB nullability (`null`, not optional). Request schemas never carry
  `price`, `vendorId`, `userId` or `role` — the server re-reads them.

## Commands

- `pnpm --filter @repo/core typecheck` — `tsc` for `src/` and `test/` (tests have their own `test/tsconfig.json` with Node types)
- `pnpm --filter @repo/core test` — Vitest, no services needed
- `pnpm --filter @repo/core build` — tsup → `dist/` (ESM + CJS + d.ts)
