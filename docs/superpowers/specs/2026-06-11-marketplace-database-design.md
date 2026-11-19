# Marketplace Database Design

- **Date:** 2026-06-11
- **Status:** Approved (design) — pending implementation plan
- **Owner:** packages/db (Prisma schema source of truth)
- **Constitution:** root `CLAUDE.md` Golden Rules + `packages/db` conventions

## 1. Purpose

Define the complete PostgreSQL/Prisma schema for the multi-vendor marketplace: identity,
vendor/KYC, catalog (i18n), cart, orders (multi-vendor split), payments, double-entry escrow
ledger, coupons, reviews, platform settings, and outbox. This is the first concrete domain
artifact; `packages/db` currently holds only a placeholder `src/index.ts`.

## 2. Locked business decisions (this design)

These were open (see `project-open-business-decisions` memory) and are now decided:

| Parameter             | Decision                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commission model      | **Per-category override**: `PlatformSettings.commission_bps` default + `Category.commission_bps_override?` (+ `Vendor.commission_bps_override?` reserved) |
| Payout hold period    | **7 days** → `PlatformSettings.hold_period_days`, seed 7                                                                                                  |
| Refund/dispute window | **7 days** → `PlatformSettings.refund_window_days`, seed 7                                                                                                |
| KYC fields            | **All four**: business license, bank account, tax ID, national ID (CCCD)                                                                                  |
| Idempotency-Key TTL   | **24h** in Redis (tunable); `Order.idempotency_key @unique` durable backstop                                                                              |

Resolution order for commission at payout time: `Vendor.commission_bps_override` →
`Category.commission_bps_override` (of the order item's category) → `PlatformSettings.commission_bps`.

## 3. Modeling decisions (forks resolved)

1. **Ledger = double-entry.** Each `LedgerEntry` is one signed posting against an `account`,
   tied to sibling legs by `txn_group_id`; `SUM(amount)` per group MUST equal 0. Chosen over
   single-entry for auditability of refunds/partial payouts and a checkable invariant.
2. **Product i18n = `ProductTranslation` table** (`(product_id, locale) → name, slug, description`),
   mirroring `CategoryTranslation`. Enables per-locale `tsvector` search. Chosen over JSONB i18n
   columns, which would break per-locale full-text indexing.
3. **Inventory = single stock per variant** (`stock_on_hand` + `stock_reserved` on `ProductVariant`).
   YAGNI on multi-warehouse; add via 2-phase migration if a requirement appears.

## 4. Global conventions

- **Models:** PascalCase singular; `@@map` to snake_case plural physical tables.
- **IDs:** ULID `String @id`; brand types in `packages/core` (`type OrderId = Brand<string,'OrderId'>`).
- **Money:** integer smallest unit, paired columns `<field>_amount Int` + `<field>_currency Currency`.
  Never float. All math via `packages/core/money`.
- **Timestamps:** `created_at DateTime @default(now())`, `updated_at DateTime @updatedAt` on every model.
- **Snapshots:** product title/price + shipping address copied into `OrderItem`/`SubOrder` at checkout;
  later edits to source rows never alter historical orders.
- **Tunables in DB:** commission/hold/refund/coupon-stack live in `PlatformSettings`, never in enums/consts.

## 5. Enums (~16)

```
Role            GUEST | CUSTOMER | VENDOR_OWNER | VENDOR_STAFF | PLATFORM_STAFF | PLATFORM_ADMIN
OAuthProvider   GOOGLE | FACEBOOK
Locale          VI | EN
Currency        VND | USD
VendorStatus    PENDING | ACTIVE | SUSPENDED
ApplicationStatus PENDING | APPROVED | REJECTED
ProductStatus   DRAFT | ACTIVE | ARCHIVED
OrderStatus     AWAITING_PAYMENT | PAID | PARTIALLY_REFUNDED | REFUNDED | CANCELLED | COMPLETED
SubOrderStatus  AWAITING_PAYMENT | PAID | PROCESSING | SHIPPED | DELIVERED | COMPLETED | REFUNDED | CANCELLED
PaymentProvider VNPAY | STRIPE
PaymentStatus   PENDING | CONFIRMED | FAILED | REFUNDED
LedgerAccount   CUSTOMER | PLATFORM_ESCROW | VENDOR_WALLET | PLATFORM_REVENUE
LedgerEntryType ESCROW_IN | PAYOUT_OUT | COMMISSION | REFUND | ADJUSTMENT
CouponScope     PLATFORM | VENDOR
DiscountType    PERCENT | FIXED
```

## 6. Models by domain (~28)

### Module 1 — Identity & Access

- **User** — `id, email?, name, avatar_url, primary_locale(Locale)`. No password column (OAuth only).
- **OAuthIdentity** — `id, user_id→User, provider, provider_user_id, email_verified`; `@@unique([provider, provider_user_id])`.
- **UserRole** — `user_id→User, role(Role), vendor_id?→Vendor`; `@@unique([user_id, role, vendor_id])`. `vendor_id` set only for VENDOR_OWNER/VENDOR_STAFF (ownership scoping).
- **Address** — `id, user_id→User, recipient_name, phone, line1, line2?, ward, district, city, country, is_default`.
- Sessions/refresh tokens: **not in DB** — Redis denylist + cookie rotation (Golden Rule #5).

### Module 2 — Vendor & KYC

- **Vendor** — `id, owner_id→User, slug @unique, display_name, status(VendorStatus), logo_url?, description?, commission_bps_override?`.
- **VendorApplication** — `id, applicant_id→User, status(ApplicationStatus), business_license_url, tax_id, national_id_number, national_id_url, bank_name, bank_account_number, account_holder, bank_verified, reviewed_by?→User, reviewed_at?, reject_reason?`. APPROVED → service creates Vendor + grants VENDOR_OWNER role inside one `$transaction`.
- **Wallet** — `id, vendor_id→Vendor @unique, balance_amount, balance_currency`. Denormalized cache; source of truth = `SUM(LedgerEntry WHERE account=VENDOR_WALLET, vendor_id=X)`.

### Module 3 — Catalog

- **Category** — `id, parent_id?→Category (self-ref tree), commission_bps_override?, sort_order`.
- **CategoryTranslation** — `id, category_id→Category, locale, name, slug`; `@@unique([category_id,locale])`, `@@unique([locale,slug])`.
- **Product** — `id, vendor_id→Vendor, status(ProductStatus), base_price_amount, base_price_currency, primary_image_url?`. Per-locale `tsvector` search columns maintained by trigger.
- **ProductTranslation** — `id, product_id→Product, locale, name, slug, description?`; `@@unique([product_id,locale])`, `@@unique([locale,slug])`.
- **ProductCategory** — `product_id→Product, category_id→Category`; `@@id([product_id,category_id])` (m2m).
- **ProductVariant** — `id, product_id→Product, sku @unique, attributes(Jsonb), price_amount, price_currency, stock_on_hand, stock_reserved`. Available = `stock_on_hand − stock_reserved`; atomic reserve via `UPDATE ... WHERE stock_on_hand - stock_reserved >= qty` in checkout txn.
- **ProductImage** — `id, product_id→Product, url, alt?, sort_order`.
- Indexes: `pg_trgm` GIN on translation `name`; `tsvector` GIN per locale on Product.

### Module 4 — Cart

- **Cart** — `id, user_id?→User @unique`. Guest cart in localStorage, merged on login.
- **CartItem** — `id, cart_id→Cart, variant_id→ProductVariant, quantity`; `@@unique([cart_id,variant_id])`. No price snapshot; price read live until checkout.

### Module 5 — Orders (aggregate root)

- **Order** — `id, customer_id→User, status(OrderStatus), currency, items_total_amount, shipping_total_amount, discount_total_amount, grand_total_amount, idempotency_key @unique`. Created via `$transaction`, split into N SubOrder.
- **SubOrder** — `id, order_id→Order, vendor_id→Vendor, status(SubOrderStatus), subtotal_amount, shipping_amount, discount_amount, commission_amount, currency, shipping_method_id?→ShippingMethod, shipping_address(Jsonb snapshot), completed_at?, payout_released_at?`.
- **OrderItem** — `id, sub_order_id→SubOrder, variant_id→ProductVariant, product_title_snapshot, variant_attributes_snapshot(Jsonb), unit_price_amount, quantity, line_total_amount, currency`. Price+title snapshot at checkout.
- **ShippingMethod** — `id, vendor_id→Vendor, name, price_amount, price_currency, est_days, is_active`.

### Module 6 — Payments & Ledger (double-entry escrow)

- **Payment** — `id, order_id→Order, provider(PaymentProvider), status(PaymentStatus), amount, currency, provider_txn_id?, raw_payload(Jsonb), attempt_no`. One row per attempt; latest = current.
- **LedgerEntry** — `id, txn_group_id(ULID), account(LedgerAccount), entry_type(LedgerEntryType), amount(signed Int), currency, order_id?→Order, sub_order_id?→SubOrder, vendor_id?→Vendor, created_at`. `SUM(amount)` per `txn_group_id` MUST = 0.

Flow:

- Checkout pay: `CUSTOMER −X` / `PLATFORM_ESCROW +X` (group g1)
- Payout release (after hold): `PLATFORM_ESCROW −Y` / `VENDOR_WALLET +(Y−c)` / `PLATFORM_REVENUE +c` (group g2)
- Refund: `PLATFORM_ESCROW −R` / `CUSTOMER +R` (group g3)

### Module 7 — Coupons

- **Coupon** — `id, scope(CouponScope), vendor_id?→Vendor, code, discount_type(DiscountType), discount_value, min_spend_amount?, currency?, max_redemptions?, per_user_limit?, starts_at, ends_at, is_active`; `@@unique([vendor_id, code])`.
- **CouponRedemption** — `id, coupon_id→Coupon, user_id→User, order_id?→Order, sub_order_id?→SubOrder, discount_amount, currency, redeemed_at`. Platform coupon → `order_id`; vendor coupon → `sub_order_id`.

### Module 8 — Reviews

- **Review** — `id, product_id→Product, author_id→User, sub_order_id→SubOrder, rating(1–5), body?`; `@@unique([author_id, sub_order_id, product_id])` (proof of purchase).

### Module 9 — Platform config & Outbox

- **PlatformSettings** — singleton `id, commission_bps, hold_period_days, refund_window_days, max_coupon_stack, supported_currencies(Currency[]), default_currency`.
- **OutboxEvent** — `id, aggregate_id, aggregate_type, event_type, payload(Jsonb), created_at, processed_at?, attempts, last_error?`; `@@index([processed_at])`. BullMQ dispatcher polls `WHERE processed_at IS NULL`.

## 7. Migrations

- **Migration A (`init`):** all models + enums + FKs + unique/index constraints Prisma can express.
- **Migration B (`add_search_indexes`):** hand-written raw SQL for `pg_trgm` extension, `tsvector`
  columns, GIN indexes, and the update triggers — Prisma cannot express these natively. This is the
  documented exception to "no hand-written SQL outside migration files" (the SQL lives _inside_ a
  migration file, which is allowed). Forward-only.
- Shadow DB stays enabled (drift detection). No `prisma db push` against non-throwaway envs.

## 8. Seed (`packages/db/src/seed.ts`, idempotent)

- `PlatformSettings` singleton: `commission_bps` default (e.g. 1000 = 10%), `hold_period_days=7`,
  `refund_window_days=7`, `supported_currencies=[VND,USD]`, `default_currency=VND`.
- Demo Google `User` (CUSTOMER), 2 sample `Vendor`s (ACTIVE) with owners.
- Category tree (vi+en translations), sample `Product`s + `ProductTranslation` + variants + images.
- Sample platform + vendor `Coupon`s.
- Never run against production.

## 9. Out of scope (deferred)

- Multi-warehouse inventory (single stock per variant for MVP).
- Vendor staff invitations table (role grant exists; invite flow later).
- Variant attribute value translations (attributes stay JSONB; translate in app layer if needed).
- Dispute/RMA workflow tables (refund window enforced in service for MVP).

## 10. Verification (for the implementation plan)

1. `pnpm db:migrate dev --name init` → schema applies; diff matches this spec.
2. `pnpm db:migrate dev --name add_search_indexes` → extensions/triggers apply on shadow DB clean.
3. `pnpm db:seed` runs twice → idempotent (no duplicate rows, no FK errors).
4. `pnpm db:generate` → Prisma Client typechecks; `packages/core` brand types align with model IDs.
5. Ledger invariant test: a seeded checkout+payout produces `SUM(amount) = 0` per `txn_group_id`.
