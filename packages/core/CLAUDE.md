# @repo/core

Domain layer: Zod schemas + `z.infer` types, Money utility, branded IDs, enums, error catalog.
Pure TypeScript + `zod` — runs in browser and Node. Never imports `@repo/db`, `apps/*` or `server`.

## Layout

| Path            | Subpath export         | What                                                                                                                                        |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/money/`    | `@repo/core/money`     | `of`, `zero`, `add`, `subtract`, `sum`, `multiply`, `applyBps`, `allocate`, `compare`, `equals`, …                                          |
| `src/ids/`      | `@repo/core/ids`       | `Brand<T, Name>`, `UlidSchema`, `XxxIdSchema` / `XxxId` per entity, `IdempotencyKeySchema`                                                  |
| `src/enums/`    | `@repo/core/enums`     | `XxxSchema` + `Xxx` (type and value object, e.g. `Role.CUSTOMER`) mirroring every Prisma enum                                               |
| `src/pricing/`  | `@repo/core/pricing`   | `priceOrder`, `evaluateCoupon`, `couponDiscount`, `resolveCommissionBps`, `computePayoutPostings` — pure checkout/payout money math (D5-D8) |
| `src/orders/`   | `@repo/core/orders`    | `deriveOrderStatus(subOrderStatuses)` — Order status from its sub-orders (D11); shared by checkout, webhook, fulfilment, refunds            |
| `src/errors/`   | `@repo/core/errors`    | `ERROR_CODES`, `ERROR_HTTP_STATUS`, `ErrorResponseSchema`, `DomainError`                                                                    |
| `src/schemas/*` | `@repo/core/schemas/*` | one file per area — see "Schemas" below                                                                                                     |

The root export (`@repo/core`) re-exports everything; Money helpers are namespaced there:
`const m: Money = Money.of(150_000, 'VND')`. Every export (root and subpaths) resolves to `dist/`, built
by tsup with `splitting` so all entries share one copy of each module (`instanceof DomainError` works
whichever path it was imported from). Consumers need `@repo/core` built first (turbo `^build`).

## Schemas

Read shapes use Money, ISO-datetime strings and branded ids. Input shapes never carry `price`,
`vendorId`, `userId` or `role`. Each entry is `XxxSchema` + `Xxx` type.

- `money`, `common`: `Money`, `NonNegativeMoney`; `Slug`, `HttpUrl`. `datetime`: `IsoDateTime` (UTC ISO string on the wire).
- `address`: `AddressInput` (create), `AddressUpdate` (partial PATCH body), `AddressParams`, `Address`, `CountryCode`, `Phone`. `category`, `product`: `Category`, `CategoryTranslation`, `Product`, `ProductVariant`, `ProductImage`, `VariantAttributes`.
- `cart`, `checkout`: `CartLineInput`, `CartLine` (+ `lineTotal`, `unavailable`), `Cart` (grouped by vendor via `CartVendorGroup`), `CartQuery`, `CartItemSet`, `CartMergeInput`, `CartMergeResult` / `CartMergeAdjustment`, `CartShippingOptions`, `Checkout`, `CouponCode`.
- `me`: `TokenResponse`, `MeResponse` (moved from the server), `ProfileUpdate`.
- `upload`: `UploadPurpose`, `UploadKey`, `PresignRequest`, `PresignResponse`. Clients send upload **keys**, never URLs (D13).
- `vendor`: `VendorPublic`, `VendorApplicationCreate`, `VendorApplication`, `VendorReject`, `VendorApprove {slug, displayName}`, `VendorApplicationMe {latest, history}`, `VendorApplicationListQuery` (+ `status`), `VendorApplicationListItem` / `ListPage` (KYC numbers masked: `taxIdMasked`, …), `VendorApplicationDetail` (full + presigned document URLs), `VendorApplicationReviewResult` (list item + `vendorId`). Document keys map to DB `businessLicenseUrl` / `nationalIdUrl`.
- `order`: `Order`, `SubOrder`, `VendorSubOrder` (adds commission + net), `OrderItem`, `OrderSummary` + `OrderSummaryPage`, `ShippingAddressSnapshot`, `PaymentSession` (`redirectUrl` null until the worker creates the session), `PaymentRetry` (`{ provider? }` body of a new payment attempt), `SubOrderShip`.
- `outbox`: payload schemas of `outbox_events` rows (ids only; `aggregateType` = `ORDER_AGGREGATE_TYPE` `'order'`, `aggregateId` = orderId) — `OrderCreatedEvent {orderId, customerId}`, `PaymentRequestedEvent {orderId, paymentId, provider, attemptNo}`, `OrderCancelledEvent {orderId, customerId, reason: OrderCancelReason}` (`CUSTOMER` / `PAYMENT_EXPIRED`), `VendorApplicationApprovedEvent {applicationId, vendorId, userId}`, `VendorApplicationRejectedEvent {applicationId, userId}` (`aggregateType` = `VENDOR_APPLICATION_AGGREGATE_TYPE` `'vendor-application'`, `aggregateId` = applicationId); `OUTBOX_EVENT_SCHEMAS` maps event type → schema for the worker. Add new event types here.
- `shipping-method`: `ShippingMethod`, `ShippingMethodInput`.
- `coupon`: `CouponInput`, `Coupon` — a union on `discountType`: FIXED carries `discount: Money`, PERCENT carries `discountBps` (basis points, 1..10000). Scope comes from the endpoint, not the body.
- `review`: `ReviewCreate`, `Review`, `RatingSummary` (`average` is null when there are no reviews).
- `catalog`: public catalog queries/reads — `CatalogLocale` (`vi|en`), `LocaleQuery`, `ProductListQuery`, `SearchQuery`, `VendorProductsQuery`, `CategoryTree`/`CategoryNode` (recursive), `CategoryDetail`, `ProductSummary`(+`Page`), `ProductDetail`, `VendorDetail`.
- `platform-settings`: `PlatformSettingsPublic`, `PlatformSettings`, `PlatformSettingsUpdate` (partial, non-empty).
- `platform-admin` (T3.4): list queries (`PlatformVendorListQuery`, `PlatformProductListQuery`, `PlatformOrderListQuery`, `PlatformUserListQuery` — page + filters + trimmed `q`, blank = absent), reads `PlatformVendor`, `PlatformProduct`, `PlatformOrderSummary`, `PlatformOrderDetail` (`Order` + customer + `PlatformPayment` (no raw payload / redirect URL) + `LedgerEntry[]` + `Refund[]`), `PlatformUser` (distinct `roles`), each with a `…Page`; bodies `PlatformVendorSuspend` / `PlatformProductBlock` (`{reason}`), `PlatformRoleGrant {role}`; `PlatformRole` = `PLATFORM_STAFF | PLATFORM_ADMIN`.
- `wallet`: `Wallet`, `LedgerEntry` (signed `amount`). `refund`: `RefundCreate` (whole sub-order, reason only), `Refund`.
- `vendor-invitation`: `VendorInvitationCreate` (email lowercased), `VendorInvitation`, `VendorInvitationAccept`.
- `product-admin`: `ProductUpsert` (both locales, variants, images by id-or-key, `categoryIds`), `VendorProductStatus` (no `BLOCKED`); vendor-side reads `VendorProduct` (raw vi + en translations, variants with `stockOnHand` / `stockReserved`, `status`, `blockedReason`), `VendorProductSummary` + `VendorProductPage`, `VendorProductQuery` (page + `status`), `VendorProductVariant`, `VariantStockUpdate` (absolute `stockOnHand`). `basePrice` in an upsert only carries the currency: the server stores MIN(variant price).

Known gaps: `VendorApplicationCreate` has no shop `displayName`/`slug` (the application table has no column
for them).

## Pricing (`src/pricing`)

Pure functions, no I/O, `now` passed in; same-currency only. Rules (D5-D8): coupons discount **item subtotals only**
(never shipping); one vendor coupon per vendor, only on that vendor's sub-order; PERCENT floor-rounded, FIXED
capped at base; platform coupons apply sequentially on the items total after vendor discounts, then split
across sub-orders by `Money.allocate` over (subtotal − vendorDiscount); vendor + platform coupons ≤
`maxCouponStack`. Commission is per line, **half-even**, on line total minus its pro-rata vendor discount
(platform coupons never reduce it). `priceOrder` throws `DomainError` (`coupon.error.*`) on rejection;
`evaluateCoupon` returns `{ ok } | { ok:false, code }`. Usage counts are inputs (caller loads them, locking the
coupon row). Invariants asserted: `paid = subtotal + shipping − vendorDiscount − platformDiscount ≥ 0`,
`net = subtotal + shipping − vendorDiscount − commission`, payout postings sum to 0.

**Pricing result → DB columns** (server checkout): `SubOrder.subtotalAmount` = `subtotal`, `shippingAmount` =
`shipping`, `discountAmount` = `vendorDiscount`, `platformDiscountAmount` = `platformDiscount`,
`commissionAmount` = `commission`; `Order.itemsTotal/shippingTotal/discountTotal/grandTotal` = the order totals;
`Payment.amount` = `grandTotal`; each `redemptions[]` entry → one `CouponRedemption` (`discount`).

## Orders (`src/orders`)

`deriveOrderStatus(statuses)` (D11, first match wins): all CANCELLED → CANCELLED; all AWAITING_PAYMENT →
AWAITING_PAYMENT; all REFUNDED → REFUNDED; any REFUNDED → PARTIALLY_REFUNDED; all COMPLETED ignoring
REFUNDED/CANCELLED (≥ 1 COMPLETED) → COMPLETED; otherwise PAID. Empty input throws `common.error.internal`.
Every writer of `SubOrder.status` must recompute `Order.status` with it in the same transaction.

`PROVIDER_CURRENCIES` / `providerSupportsCurrency(provider, currency)`: VNPay charges VND only, Stripe VND + USD.
Checked at checkout and payment retry (`payment.error.provider-currency-unsupported`).

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
