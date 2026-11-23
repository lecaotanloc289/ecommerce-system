# @repo/core

Domain layer: Zod schemas + `z.infer` types, Money utility, branded IDs, enums, error catalog.
Pure TypeScript + `zod` — runs in browser and Node. Never imports `@repo/db`, `apps/*` or `server`.

## Layout

| Path            | Subpath export         | What                                                                                                                                                                                                                                          |
| --------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/money/`    | `@repo/core/money`     | `of`, `zero`, `add`, `subtract`, `sum`, `multiply`, `applyBps`, `allocate`, `compare`, `equals`, …                                                                                                                                            |
| `src/ids/`      | `@repo/core/ids`       | `Brand<T, Name>`, `UlidSchema`, `XxxIdSchema` / `XxxId` per entity, `IdempotencyKeySchema`                                                                                                                                                    |
| `src/enums/`    | `@repo/core/enums`     | `XxxSchema` + `Xxx` (type and value object, e.g. `Role.CUSTOMER`) mirroring every Prisma enum                                                                                                                                                 |
| `src/pricing/`  | `@repo/core/pricing`   | `priceOrder`, `evaluateCoupon`, `couponDiscount`, `resolveCommissionBps`, `computePayoutPostings`, `refundAmount`, `refundPostings` — pure checkout/payout/refund money math (D5-D8, D12)                                                     |
| `src/orders/`   | `@repo/core/orders`    | `deriveOrderStatus` (Order status from its sub-orders, D11); `subOrderPaid`, `subOrderNet`, `computeEscrowInPostings`, `computeRefundPostings` (escrow ledger pairs, D3/D7/D12); sub-order state machine `canTransition` / `assertTransition` |
| `src/crm/`      | `@repo/core/crm`       | `classifyCustomer`, `assertCrmTemplate` / `findLink` (NFKC-normalised link detection), `renderCrmTemplate`, `assertCrmCouponCode`, `deriveUnsubscribeToken` / `hashUnsubscribeToken` (WebCrypto HMAC, browser + Node safe)                    |
| `src/errors/`   | `@repo/core/errors`    | `ERROR_CODES`, `ERROR_HTTP_STATUS`, `ErrorResponseSchema`, `DomainError`                                                                                                                                                                      |
| `src/schemas/*` | `@repo/core/schemas/*` | one file per area (incl. `crm`, `notification`) — see "Schemas" below                                                                                                                                                                         |

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
- `order`: `Order`, `SubOrder`, `VendorSubOrder` (adds commission + net), `OrderItem`, `OrderSummary` + `OrderSummaryPage`, `ShippingAddressSnapshot`, `PaymentSession` (`redirectUrl` null until the worker creates the session), `PaymentRetry` (`{ provider? }` body of a new payment attempt), `SubOrderShip`; vendor fulfilment reads `VendorSubOrderStatus` (statuses a vendor may see: PAID..COMPLETED + REFUNDED), `VendorSubOrderQuery` (page + `status`), `VendorSubOrderPage`.
- `outbox`: payload schemas of `outbox_events` rows (ids only; `aggregateType` = `ORDER_AGGREGATE_TYPE` `'order'`, `aggregateId` = orderId) — `OrderCreatedEvent {orderId, customerId}`, `PaymentRequestedEvent {orderId, paymentId, provider, attemptNo}`, `OrderCancelledEvent {orderId, customerId, reason: OrderCancelReason}` (`CUSTOMER` / `PAYMENT_EXPIRED`), `SubOrderShippedEvent` / `SubOrderDeliveredEvent {orderId, subOrderId, customerId}`, `SubOrderCompletedEvent {orderId, subOrderId, vendorId}` (`sub-order.shipped` / `.delivered` / `.completed`, order aggregate), `OrderPaidEvent {orderId, customerId}` (`order.paid`), `PayoutReleasedEvent {subOrderId, vendorId}` (`payout.released`, T3.2, order aggregate; the worker emails the vendor owner), `RefundRequestedEvent {refundId, orderId, subOrderId}` (worker calls the provider refund; skip unless the Refund is PENDING), `VendorApplicationApprovedEvent {applicationId, vendorId, userId}`, `VendorApplicationRejectedEvent {applicationId, userId}` (`aggregateType` = `VENDOR_APPLICATION_AGGREGATE_TYPE` `'vendor-application'`, `aggregateId` = applicationId); `OUTBOX_EVENT_SCHEMAS` maps event type → schema for the worker. Add new event types here.
- `shipping-method`: `ShippingMethod`, `ShippingMethodInput`.
- `crm`: vendor CRM contracts — `CrmCustomerSummary` / `CrmCustomerDetail` (+ pages), `CrmSegmentCounts`, `CrmAutomation`, `CrmCampaign` (+ create / update / schedule / cancel bodies, `CrmCampaignPreview`), `CrmAudienceFilter`, `CrmTemplateText`, `CrmCouponCode`, `CrmTag`, `VendorPreference` / `UpdateVendorPreference`, `Unsubscribe` (token length `UNSUBSCRIBE_TOKEN_LENGTH`); `CRM_*` limits (template, tag, note, campaign look-ahead).
- `notification`: `Notification`, `UnreadCount`.
- `coupon`: `CouponInput`, `Coupon` — a union on `discountType`: FIXED carries `discount: Money`, PERCENT carries `discountBps` (basis points, 1..10000). Scope comes from the endpoint, not the body.
- `review`: `ReviewCreateBody` (`{subOrderId, rating, body?}`, body of `POST /v1/products/:id/reviews`), `ReviewCreate` (+ `productId`), `Review`, `RatingSummary` (`average` is null when there are no reviews), `ReviewPage` (`PageSchema(Review)` + `summary`), `REVIEW_BODY_MAX_LENGTH`.
- `catalog`: public catalog queries/reads — `CatalogLocale` (`vi|en`), `LocaleQuery`, `ProductListQuery`, `SearchQuery`, `VendorProductsQuery`, `CategoryTree`/`CategoryNode` (recursive), `CategoryDetail`, `ProductSummary`(+`Page`), `ProductDetail`, `VendorDetail`.
- `platform-settings`: `PlatformSettingsPublic`, `PlatformSettings`, `PlatformSettingsUpdate` (partial, non-empty).
- `platform-admin` (T3.4): list queries (`PlatformVendorListQuery`, `PlatformProductListQuery`, `PlatformOrderListQuery`, `PlatformUserListQuery` — page + filters + trimmed `q`, blank = absent), reads `PlatformVendor`, `PlatformProduct`, `PlatformOrderSummary`, `PlatformOrderDetail` (`Order` + customer + `PlatformPayment` (no raw payload / redirect URL) + `LedgerEntry[]` + `Refund[]`), `PlatformUser` (distinct `roles`), each with a `…Page`; bodies `PlatformVendorSuspend` / `PlatformProductBlock` (`{reason}`), `PlatformRoleGrant {role}`; `PlatformRole` = `PLATFORM_STAFF | PLATFORM_ADMIN`.
- `wallet`: `Wallet`, `LedgerEntry` (signed `amount`), `LedgerEntryPage`, `VendorWallet` (`Wallet` + `pending: Money[]`, one per currency). `refund`: `RefundCreate` (whole sub-order, reason only), `Refund`, `RefundListQuery` (page + `status`), `RefundListItem` (`Refund` + `orderId` + `vendorId`) + `RefundPage`.
- `vendor-invitation`: `VendorInvitationCreate` (email lowercased), `VendorInvitation` (+ derived `status`: `VendorInvitationStatus`), `VendorInvitationPage`, `VendorInvitationAccept`, `VendorInvitationAcceptResult {vendorId}`, `VendorStaffMember`. Outbox `VendorInvitationCreatedEvent {invitationId, vendorId, email, token}` (`VENDOR_INVITATION_AGGREGATE_TYPE`) carries the raw token — the worker must scrub it after sending.
- `zalo`: automated Zalo messages — `ZALO_TEMPLATE_PLACEHOLDERS` + `findUnknownZaloPlaceholder` / `renderZaloTemplate` (`{{name}}`, unknown left verbatim), `formatOrderCode` (`#` + last 8 of the order id), `ZALO_STATUS_EVENTS` / `zaloEventForSubOrderStatus`; `ZaloTemplateUpsert` / `ZaloTemplate` / `ZaloTemplateList` / `ZaloTemplateParams`; `ZaloAccount(Response)`; QR login `ZaloLoginStart` / `ZaloLoginParams` / `ZaloLoginState` (PENDING → QR_READY → SCANNED → SUCCESS | EXPIRED | DECLINED | FAILED) and the API↔worker Redis contract `ZaloLoginRecord`, `ZALO_LOGIN_QUEUE_KEY`, `zaloLoginKey`, `ZALO_LOGIN_TTL_SECONDS`; message log `ZaloMessage` / `ZaloMessagePage` / `ZaloMessageListQuery`, `ZaloSkipReason`. `Checkout.zaloOptIn` (default false).
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

**Refunds (D12, `src/pricing/refund.ts`):** `refundAmount({subtotal, shipping, vendorDiscount, platformDiscount})` =
`paid_i` of a sub-order (≥ 0, may be 0; negative or mixed currency throws). `refundPostings(paid)` →
`[PLATFORM_ESCROW −paid, CUSTOMER +paid]` (one txn group, mirror of the escrow-IN group; sums to 0; negative throws).

**Pricing result → DB columns** (server checkout): `SubOrder.subtotalAmount` = `subtotal`, `shippingAmount` =
`shipping`, `discountAmount` = `vendorDiscount`, `platformDiscountAmount` = `platformDiscount`,
`commissionAmount` = `commission`; `Order.itemsTotal/shippingTotal/discountTotal/grandTotal` = the order totals;
`Payment.amount` = `grandTotal`; each `redemptions[]` entry → one `CouponRedemption` (`discount`).

## Orders (`src/orders`)

`deriveOrderStatus(statuses)` (D11, first match wins): all CANCELLED → CANCELLED; all AWAITING_PAYMENT →
AWAITING_PAYMENT; all REFUNDED → REFUNDED; any REFUNDED → PARTIALLY_REFUNDED; all COMPLETED ignoring
REFUNDED/CANCELLED (≥ 1 COMPLETED) → COMPLETED; otherwise PAID. Empty input throws `common.error.internal`.
Every writer of `SubOrder.status` must recompute `Order.status` with it in the same transaction.

`sub-order-state.ts` — the sub-order state machine (D11), the one table of legal moves: `SUB_ORDER_TRANSITIONS`
(from → `[{ to, actors }]`), `canTransition(from, to, actor)`, `assertTransition` (throws 409
`order.error.invalid-status-transition {from, to}`), `transitionSources(to, actor)`. Actors (`SubOrderActor`):
`CUSTOMER`, `VENDOR`, `PLATFORM` (admin refund), `SYSTEM` (webhook / jobs). Edges: AWAITING_PAYMENT → PAID
(SYSTEM) | CANCELLED (CUSTOMER, SYSTEM); PAID → PROCESSING (VENDOR); PROCESSING → SHIPPED (VENDOR); SHIPPED →
DELIVERED (VENDOR) | COMPLETED (CUSTOMER); DELIVERED → COMPLETED (CUSTOMER, SYSTEM); PAID..DELIVERED → REFUNDED
(PLATFORM). COMPLETED / REFUNDED / CANCELLED are terminal. Every writer of `SubOrder.status` checks it.

Escrow (`src/orders/escrow.ts`, D3/D7/D12): `subOrderPaid({subtotal, shipping, vendorDiscount, platformDiscount})` =
`paid_i` (throws if negative); `subOrderNet({...same, commission})` = `net_i` = subtotal + shipping − vendorDiscount − commission (throws if negative; the payout job feeds `subOrderPaid` + `subOrderNet` into `computePayoutPostings`); `computeEscrowInPostings(paid)` → `[CUSTOMER −paid, PLATFORM_ESCROW +paid]` (payment
confirmed, entry type `ESCROW_IN`); `computeRefundPostings(paid)` → `[PLATFORM_ESCROW −paid, CUSTOMER +paid]` (refund,
`REFUND`). One ledger txn group per sub-order; skip a group when `paid_i` is 0. Shared by the API (payment confirmation)
and the worker (zero-amount confirmation, payouts).

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
- **CRM templates:** plain text only. Placeholders are `{customerName}`, `{shopName}`, `{couponCode}` and
  nothing else; links are rejected (`crm.error.links-not-allowed`); `{couponCode}` requires an attached coupon.

## Commands

- `pnpm --filter @repo/core typecheck` — `tsc` for `src/` and `test/` (tests have their own `test/tsconfig.json` with Node types)
- `pnpm --filter @repo/core test` — Vitest, no services needed
- `pnpm --filter @repo/core build` — tsup → `dist/` (ESM + CJS + d.ts)
