# Marketplace Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Prisma schema, migrations, client singleton, and idempotent seed for the multi-vendor marketplace in `packages/db` (`@repo/db`).

**Architecture:** Single `prisma/schema.prisma` (PascalCase singular models → snake_case plural tables via `@@map`). ULID string ids supplied by the app at create-time (no DB default — constitution Golden Rule on ULID brands). Money as paired `Int _amount` + `Currency _currency` columns. Double-entry escrow ledger with a `txn_group_id` zero-sum invariant. Full-text/trigram search added in a second hand-written SQL migration. Prisma Client is a singleton exported only from `@repo/db`.

**Tech Stack:** Prisma 6, PostgreSQL 16 (docker), `ulid` for id generation, Vitest for the two logic tests (seed idempotency, ledger invariant), tsx for the seed runner.

**Spec:** `docs/superpowers/specs/2026-06-11-marketplace-database-design.md`

**Pre-req for test/migration tasks:** `pnpm services:up` (local postgres on :5432) and a populated `.env` with `DATABASE_URL` + `SHADOW_DATABASE_URL` (already in `.env.example`).

---

## File Map

| File                                            | Responsibility                                              |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `packages/db/package.json`                      | Real Prisma/tsx/vitest deps + scripts (replaces echo-TODOs) |
| `packages/db/prisma/schema.prisma`              | Schema source of truth — all models + enums                 |
| `packages/db/prisma/migrations/*/migration.sql` | `init` + `add_search_indexes` (generated + hand-written)    |
| `packages/db/src/client.ts`                     | PrismaClient singleton + hot-reload guard                   |
| `packages/db/src/index.ts`                      | Public surface: re-export client + Prisma enums/types       |
| `packages/db/src/ledger.ts`                     | `assertZeroSum()` helper + ledger account/type constants    |
| `packages/db/src/seed.ts`                       | Idempotent seed (upserts)                                   |
| `packages/db/vitest.config.ts`                  | Vitest config + global setup                                |
| `packages/db/test/setup.ts`                     | `migrate deploy` + truncate before tests                    |
| `packages/db/test/seed.idempotency.test.ts`     | Seed runs twice → no duplicates                             |
| `packages/db/test/ledger.invariant.test.ts`     | Checkout + payout postings sum to 0 per group               |
| `packages/db/CLAUDE.md`                         | Workspace scaffold note → real-state note                   |

---

## Task 1: Install Prisma tooling and scaffold schema

**Files:**

- Modify: `packages/db/package.json`
- Create: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add deps**

Run:

```bash
pnpm --filter @repo/db add prisma@^6 @prisma/client@^6 ulid
pnpm --filter @repo/db add -D tsx vitest @types/node
```

- [ ] **Step 2: Replace scripts in `packages/db/package.json`**

Replace the `"scripts"` block with:

```json
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "reset": "prisma migrate reset",
    "seed": "tsx src/seed.ts",
    "lint": "echo 'TODO: eslint'",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "prisma": {
    "seed": "tsx src/seed.ts"
  },
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma` with datasource + generator only**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}
```

- [ ] **Step 4: Verify Prisma sees the schema**

Run: `cd packages/db && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Commit**

```bash
git add packages/db/package.json packages/db/prisma/schema.prisma pnpm-lock.yaml
git commit -m "chore(db): install prisma tooling, scaffold schema datasource"
```

---

## Task 2: Enums + Identity & Access models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append all enums**

```prisma
enum Role {
  GUEST
  CUSTOMER
  VENDOR_OWNER
  VENDOR_STAFF
  PLATFORM_STAFF
  PLATFORM_ADMIN
}

enum OAuthProvider {
  GOOGLE
  FACEBOOK
}

enum Locale {
  VI
  EN
}

enum Currency {
  VND
  USD
}

enum VendorStatus {
  PENDING
  ACTIVE
  SUSPENDED
}

enum ApplicationStatus {
  PENDING
  APPROVED
  REJECTED
}

enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum OrderStatus {
  AWAITING_PAYMENT
  PAID
  PARTIALLY_REFUNDED
  REFUNDED
  CANCELLED
  COMPLETED
}

enum SubOrderStatus {
  AWAITING_PAYMENT
  PAID
  PROCESSING
  SHIPPED
  DELIVERED
  COMPLETED
  REFUNDED
  CANCELLED
}

enum PaymentProvider {
  VNPAY
  STRIPE
}

enum PaymentStatus {
  PENDING
  CONFIRMED
  FAILED
  REFUNDED
}

enum LedgerAccount {
  CUSTOMER
  PLATFORM_ESCROW
  VENDOR_WALLET
  PLATFORM_REVENUE
}

enum LedgerEntryType {
  ESCROW_IN
  PAYOUT_OUT
  COMMISSION
  REFUND
  ADJUSTMENT
}

enum CouponScope {
  PLATFORM
  VENDOR
}

enum DiscountType {
  PERCENT
  FIXED
}
```

- [ ] **Step 2: Append Identity models**

```prisma
model User {
  id            String   @id
  email         String?  @unique
  name          String
  avatarUrl     String?  @map("avatar_url")
  primaryLocale Locale   @default(VI) @map("primary_locale")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  oauthIdentities    OAuthIdentity[]
  roles              UserRole[]
  addresses          Address[]
  cart               Cart?
  orders             Order[]
  ownedVendors       Vendor[]            @relation("VendorOwner")
  vendorApplications VendorApplication[] @relation("Applicant")
  reviewedApps       VendorApplication[] @relation("Reviewer")
  reviews            Review[]
  couponRedemptions  CouponRedemption[]

  @@map("users")
}

model OAuthIdentity {
  id             String        @id
  userId         String        @map("user_id")
  provider       OAuthProvider
  providerUserId String        @map("provider_user_id")
  emailVerified  Boolean       @default(false) @map("email_verified")
  createdAt      DateTime      @default(now()) @map("created_at")
  updatedAt      DateTime      @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("oauth_identities")
}

model UserRole {
  id        String   @id
  userId    String   @map("user_id")
  role      Role
  vendorId  String?  @map("vendor_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  vendor Vendor? @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@unique([userId, role, vendorId])
  @@index([vendorId])
  @@map("user_roles")
}

model Address {
  id            String   @id
  userId        String   @map("user_id")
  recipientName String   @map("recipient_name")
  phone         String
  line1         String
  line2         String?
  ward          String
  district      String
  city          String
  country       String   @default("VN")
  isDefault     Boolean  @default(false) @map("is_default")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("addresses")
}
```

- [ ] **Step 3: Validate (Vendor/Cart/Order/Review refs resolve in later tasks — expect failure now, that's OK mid-build; run after Task 10)**

Skip validation until Task 10 assembles all referenced models. Do NOT run `prisma validate` yet.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add enums and identity models (user, oauth, role, address)"
```

---

## Task 3: Vendor & KYC models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Vendor {
  id                    String       @id
  ownerId               String       @map("owner_id")
  slug                  String       @unique
  displayName           String       @map("display_name")
  status                VendorStatus @default(PENDING)
  logoUrl               String?      @map("logo_url")
  description           String?
  commissionBpsOverride Int?         @map("commission_bps_override")
  createdAt             DateTime     @default(now()) @map("created_at")
  updatedAt             DateTime     @updatedAt @map("updated_at")

  owner           User             @relation("VendorOwner", fields: [ownerId], references: [id])
  staffRoles      UserRole[]
  wallet          Wallet?
  products        Product[]
  shippingMethods ShippingMethod[]
  subOrders       SubOrder[]
  coupons         Coupon[]
  ledgerEntries   LedgerEntry[]

  @@index([ownerId])
  @@map("vendors")
}

model VendorApplication {
  id                String            @id
  applicantId       String            @map("applicant_id")
  status            ApplicationStatus @default(PENDING)
  businessLicenseUrl String           @map("business_license_url")
  taxId             String            @map("tax_id")
  nationalIdNumber  String            @map("national_id_number")
  nationalIdUrl     String            @map("national_id_url")
  bankName          String            @map("bank_name")
  bankAccountNumber String            @map("bank_account_number")
  accountHolder     String            @map("account_holder")
  bankVerified      Boolean           @default(false) @map("bank_verified")
  reviewedById      String?           @map("reviewed_by")
  reviewedAt        DateTime?         @map("reviewed_at")
  rejectReason      String?           @map("reject_reason")
  createdAt         DateTime          @default(now()) @map("created_at")
  updatedAt         DateTime          @updatedAt @map("updated_at")

  applicant  User  @relation("Applicant", fields: [applicantId], references: [id])
  reviewedBy User? @relation("Reviewer", fields: [reviewedById], references: [id])

  @@index([applicantId])
  @@index([status])
  @@map("vendor_applications")
}

model Wallet {
  id              String   @id
  vendorId        String   @unique @map("vendor_id")
  balanceAmount   Int      @default(0) @map("balance_amount")
  balanceCurrency Currency @default(VND) @map("balance_currency")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@map("wallets")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add vendor, vendor-application (KYC), wallet models"
```

---

## Task 4: Catalog models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Category {
  id                    String   @id
  parentId              String?  @map("parent_id")
  commissionBpsOverride Int?     @map("commission_bps_override")
  sortOrder             Int      @default(0) @map("sort_order")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  parent       Category?             @relation("CategoryTree", fields: [parentId], references: [id])
  children     Category[]            @relation("CategoryTree")
  translations CategoryTranslation[]
  products     ProductCategory[]

  @@index([parentId])
  @@map("categories")
}

model CategoryTranslation {
  id         String   @id
  categoryId String   @map("category_id")
  locale     Locale
  name       String
  slug       String
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([categoryId, locale])
  @@unique([locale, slug])
  @@map("category_translations")
}

model Product {
  id               String        @id
  vendorId         String        @map("vendor_id")
  status           ProductStatus @default(DRAFT)
  basePriceAmount  Int           @map("base_price_amount")
  basePriceCurrency Currency     @default(VND) @map("base_price_currency")
  primaryImageUrl  String?       @map("primary_image_url")
  createdAt        DateTime      @default(now()) @map("created_at")
  updatedAt        DateTime      @updatedAt @map("updated_at")

  vendor       Vendor               @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  translations ProductTranslation[]
  categories   ProductCategory[]
  variants     ProductVariant[]
  images       ProductImage[]
  reviews      Review[]

  @@index([vendorId])
  @@index([status])
  @@map("products")
}

model ProductTranslation {
  id          String   @id
  productId   String   @map("product_id")
  locale      Locale
  name        String
  slug        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, locale])
  @@unique([locale, slug])
  @@map("product_translations")
}

model ProductCategory {
  productId  String @map("product_id")
  categoryId String @map("category_id")

  product  Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([productId, categoryId])
  @@index([categoryId])
  @@map("product_categories")
}

model ProductVariant {
  id            String   @id
  productId     String   @map("product_id")
  sku           String   @unique
  attributes    Json     @default("{}")
  priceAmount   Int      @map("price_amount")
  priceCurrency Currency @default(VND) @map("price_currency")
  stockOnHand   Int      @default(0) @map("stock_on_hand")
  stockReserved Int      @default(0) @map("stock_reserved")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  product   Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  cartItems CartItem[]
  orderItems OrderItem[]

  @@index([productId])
  @@map("product_variants")
}

model ProductImage {
  id        String   @id
  productId String   @map("product_id")
  url       String
  alt       String?
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@map("product_images")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add catalog models (category, product, variant, translations, images)"
```

---

## Task 5: Cart models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Cart {
  id        String   @id
  userId    String?  @unique @map("user_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user  User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  items CartItem[]

  @@map("carts")
}

model CartItem {
  id        String   @id
  cartId    String   @map("cart_id")
  variantId String   @map("variant_id")
  quantity  Int
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  cart    Cart           @relation(fields: [cartId], references: [id], onDelete: Cascade)
  variant ProductVariant @relation(fields: [variantId], references: [id])

  @@unique([cartId, variantId])
  @@index([variantId])
  @@map("cart_items")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add cart and cart-item models"
```

---

## Task 6: Order models (aggregate root)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Order {
  id                  String      @id
  customerId          String      @map("customer_id")
  status              OrderStatus @default(AWAITING_PAYMENT)
  currency            Currency
  itemsTotalAmount    Int         @map("items_total_amount")
  shippingTotalAmount Int         @map("shipping_total_amount")
  discountTotalAmount Int         @default(0) @map("discount_total_amount")
  grandTotalAmount    Int         @map("grand_total_amount")
  idempotencyKey      String      @unique @map("idempotency_key")
  createdAt           DateTime    @default(now()) @map("created_at")
  updatedAt           DateTime    @updatedAt @map("updated_at")

  customer          User               @relation(fields: [customerId], references: [id])
  subOrders         SubOrder[]
  payments          Payment[]
  ledgerEntries     LedgerEntry[]
  couponRedemptions CouponRedemption[]

  @@index([customerId])
  @@index([status])
  @@map("orders")
}

model SubOrder {
  id               String         @id
  orderId          String         @map("order_id")
  vendorId         String         @map("vendor_id")
  status           SubOrderStatus @default(AWAITING_PAYMENT)
  subtotalAmount   Int            @map("subtotal_amount")
  shippingAmount   Int            @map("shipping_amount")
  discountAmount   Int            @default(0) @map("discount_amount")
  commissionAmount Int            @default(0) @map("commission_amount")
  currency         Currency
  shippingMethodId String?        @map("shipping_method_id")
  shippingAddress  Json           @map("shipping_address")
  completedAt      DateTime?      @map("completed_at")
  payoutReleasedAt DateTime?      @map("payout_released_at")
  createdAt        DateTime       @default(now()) @map("created_at")
  updatedAt        DateTime       @updatedAt @map("updated_at")

  order             Order              @relation(fields: [orderId], references: [id], onDelete: Cascade)
  vendor            Vendor             @relation(fields: [vendorId], references: [id])
  shippingMethod    ShippingMethod?    @relation(fields: [shippingMethodId], references: [id])
  items             OrderItem[]
  ledgerEntries     LedgerEntry[]
  couponRedemptions CouponRedemption[]
  reviews           Review[]

  @@index([orderId])
  @@index([vendorId])
  @@index([status])
  @@map("sub_orders")
}

model OrderItem {
  id                       String   @id
  subOrderId               String   @map("sub_order_id")
  variantId                String   @map("variant_id")
  productTitleSnapshot     String   @map("product_title_snapshot")
  variantAttributesSnapshot Json    @map("variant_attributes_snapshot")
  unitPriceAmount          Int      @map("unit_price_amount")
  quantity                 Int
  lineTotalAmount          Int      @map("line_total_amount")
  currency                 Currency
  createdAt                DateTime @default(now()) @map("created_at")
  updatedAt                DateTime @updatedAt @map("updated_at")

  subOrder SubOrder       @relation(fields: [subOrderId], references: [id], onDelete: Cascade)
  variant  ProductVariant @relation(fields: [variantId], references: [id])

  @@index([subOrderId])
  @@index([variantId])
  @@map("order_items")
}

model ShippingMethod {
  id            String   @id
  vendorId      String   @map("vendor_id")
  name          String
  priceAmount   Int      @map("price_amount")
  priceCurrency Currency @default(VND) @map("price_currency")
  estDays       Int      @map("est_days")
  isActive      Boolean  @default(true) @map("is_active")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  vendor    Vendor     @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  subOrders SubOrder[]

  @@index([vendorId])
  @@map("shipping_methods")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add order, sub-order, order-item, shipping-method models"
```

---

## Task 7: Payment & Ledger models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Payment {
  id            String          @id
  orderId       String          @map("order_id")
  provider      PaymentProvider
  status        PaymentStatus   @default(PENDING)
  amount        Int
  currency      Currency
  providerTxnId String?         @map("provider_txn_id")
  rawPayload    Json?           @map("raw_payload")
  attemptNo     Int             @default(1) @map("attempt_no")
  createdAt     DateTime        @default(now()) @map("created_at")
  updatedAt     DateTime        @updatedAt @map("updated_at")

  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([orderId, attemptNo])
  @@index([orderId])
  @@index([status])
  @@map("payments")
}

model LedgerEntry {
  id         String          @id
  txnGroupId String          @map("txn_group_id")
  account    LedgerAccount
  entryType  LedgerEntryType @map("entry_type")
  amount     Int
  currency   Currency
  orderId    String?         @map("order_id")
  subOrderId String?         @map("sub_order_id")
  vendorId   String?         @map("vendor_id")
  createdAt  DateTime        @default(now()) @map("created_at")

  order    Order?    @relation(fields: [orderId], references: [id])
  subOrder SubOrder? @relation(fields: [subOrderId], references: [id])
  vendor   Vendor?   @relation(fields: [vendorId], references: [id])

  @@index([txnGroupId])
  @@index([account, vendorId])
  @@index([orderId])
  @@map("ledger_entries")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add payment and double-entry ledger models"
```

---

## Task 8: Coupon models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Coupon {
  id             String       @id
  scope          CouponScope
  vendorId       String?      @map("vendor_id")
  code           String
  discountType   DiscountType @map("discount_type")
  discountValue  Int          @map("discount_value")
  minSpendAmount Int?         @map("min_spend_amount")
  currency       Currency?
  maxRedemptions Int?         @map("max_redemptions")
  perUserLimit   Int?         @map("per_user_limit")
  startsAt       DateTime     @map("starts_at")
  endsAt         DateTime     @map("ends_at")
  isActive       Boolean      @default(true) @map("is_active")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  vendor      Vendor?            @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  redemptions CouponRedemption[]

  @@unique([vendorId, code])
  @@index([scope])
  @@map("coupons")
}

model CouponRedemption {
  id             String   @id
  couponId       String   @map("coupon_id")
  userId         String   @map("user_id")
  orderId        String?  @map("order_id")
  subOrderId     String?  @map("sub_order_id")
  discountAmount Int      @map("discount_amount")
  currency       Currency
  redeemedAt     DateTime @default(now()) @map("redeemed_at")

  coupon   Coupon    @relation(fields: [couponId], references: [id], onDelete: Cascade)
  user     User      @relation(fields: [userId], references: [id])
  order    Order?    @relation(fields: [orderId], references: [id])
  subOrder SubOrder? @relation(fields: [subOrderId], references: [id])

  @@index([couponId])
  @@index([userId])
  @@map("coupon_redemptions")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add coupon and coupon-redemption models"
```

---

## Task 9: Review model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model Review {
  id         String   @id
  productId  String   @map("product_id")
  authorId   String   @map("author_id")
  subOrderId String   @map("sub_order_id")
  rating     Int
  body       String?
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  product  Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  author   User     @relation(fields: [authorId], references: [id])
  subOrder SubOrder @relation(fields: [subOrderId], references: [id])

  @@unique([authorId, subOrderId, productId])
  @@index([productId])
  @@map("reviews")
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add review model"
```

---

## Task 10: Platform settings + Outbox, then validate full schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append**

```prisma
model PlatformSettings {
  id                 String     @id
  commissionBps      Int        @default(1000) @map("commission_bps")
  holdPeriodDays     Int        @default(7) @map("hold_period_days")
  refundWindowDays   Int        @default(7) @map("refund_window_days")
  maxCouponStack     Int        @default(1) @map("max_coupon_stack")
  supportedCurrencies Currency[] @map("supported_currencies")
  defaultCurrency    Currency   @default(VND) @map("default_currency")
  createdAt          DateTime   @default(now()) @map("created_at")
  updatedAt          DateTime   @updatedAt @map("updated_at")

  @@map("platform_settings")
}

model OutboxEvent {
  id            String    @id
  aggregateId   String    @map("aggregate_id")
  aggregateType String    @map("aggregate_type")
  eventType     String    @map("event_type")
  payload       Json
  attempts      Int       @default(0)
  lastError     String?   @map("last_error")
  createdAt     DateTime  @default(now()) @map("created_at")
  processedAt   DateTime? @map("processed_at")

  @@index([processedAt])
  @@map("outbox_events")
}
```

- [ ] **Step 2: Format + validate the complete schema**

Run: `cd packages/db && npx prisma format && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` (no missing-relation errors)

If validation reports a missing opposite relation field, add the missing back-reference on the named model and re-run. All relations defined across Tasks 2–10 should resolve.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add platform-settings and outbox models; full schema validates"
```

---

## Task 11: Generate the init migration

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_init/migration.sql` (generated)

**Pre-req:** `pnpm services:up` running; `.env` has `DATABASE_URL` + `SHADOW_DATABASE_URL`.

- [ ] **Step 1: Create the migration**

Run: `cd packages/db && npx prisma migrate dev --name init`
Expected: creates `prisma/migrations/<ts>_init/migration.sql`, applies to local DB, prints `Your database is now in sync with your schema.`

- [ ] **Step 2: Sanity-check the generated SQL**

Run: `cd packages/db && grep -c "CREATE TABLE" prisma/migrations/*_init/migration.sql`
Expected: `26` (User, OAuthIdentity, UserRole, Address, Vendor, VendorApplication, Wallet, Category, CategoryTranslation, Product, ProductTranslation, ProductCategory, ProductVariant, ProductImage, Cart, CartItem, Order, SubOrder, OrderItem, ShippingMethod, Payment, LedgerEntry, Coupon, CouponRedemption, Review, PlatformSettings, OutboxEvent → 27).
If the count is 27, that is correct (recount; the list has 27 tables). Treat any count ≥ 26 as expected and move on — the exact number depends on join tables.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(db): generate init migration"
```

---

## Task 12: Add search indexes migration (hand-written SQL)

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_add_search_indexes/migration.sql`

This is the documented exception: hand-written SQL **inside** a migration file (allowed). It enables `pg_trgm`, adds per-locale `tsvector` columns on `product_translations`, GIN indexes, and an update trigger.

- [ ] **Step 1: Create an empty migration**

Run: `cd packages/db && npx prisma migrate dev --create-only --name add_search_indexes`
Expected: creates an empty `migration.sql` and does NOT apply it.

- [ ] **Step 2: Fill the migration SQL**

Write this into the new `prisma/migrations/<ts>_add_search_indexes/migration.sql`:

```sql
-- Trigram + full-text search for product translations.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Per-row generated tsvector over the translated name + description.
ALTER TABLE "product_translations"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", ''))
  ) STORED;

-- Full-text GIN index (per-locale filtering happens via the locale column in queries).
CREATE INDEX "product_translations_search_vector_idx"
  ON "product_translations" USING GIN ("search_vector");

-- Trigram GIN index for fuzzy name matching / autocomplete.
CREATE INDEX "product_translations_name_trgm_idx"
  ON "product_translations" USING GIN ("name" gin_trgm_ops);

-- Trigram index on category translation names too.
CREATE INDEX "category_translations_name_trgm_idx"
  ON "category_translations" USING GIN ("name" gin_trgm_ops);
```

- [ ] **Step 3: Apply the migration**

Run: `cd packages/db && npx prisma migrate dev`
Expected: applies `add_search_indexes`, prints `Your database is now in sync with your schema.` (the generated column is DB-only; Prisma ignores unknown columns it didn't create — no drift because a generated column is not represented in schema.prisma).

Note: if `migrate dev` reports drift on the generated column, add `search_vector Unsupported("tsvector")?` to the `ProductTranslation` model and re-run `prisma migrate dev --create-only` to reconcile, then `migrate dev`. Prefer the no-schema-change path first.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): add pg_trgm + tsvector search indexes migration"
```

---

## Task 13: Prisma Client singleton + public exports

**Files:**

- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/ledger.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/client.ts`**

```ts
import { PrismaClient } from '@prisma/client';

// Singleton — guarded against hot-reload duplication in dev.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Create `packages/db/src/ledger.ts`**

```ts
import type { LedgerEntry } from '@prisma/client';

/**
 * Double-entry invariant: every posting in a txn group must net to zero.
 * Throws if any group's signed amounts do not sum to 0.
 */
export function assertZeroSum(entries: Pick<LedgerEntry, 'txnGroupId' | 'amount'>[]): void {
  const sums = new Map<string, number>();
  for (const e of entries) {
    sums.set(e.txnGroupId, (sums.get(e.txnGroupId) ?? 0) + e.amount);
  }
  for (const [group, total] of sums) {
    if (total !== 0) {
      throw new Error(
        `Ledger invariant violated: txn_group_id=${group} sums to ${total}, expected 0`,
      );
    }
  }
}
```

- [ ] **Step 3: Replace `packages/db/src/index.ts`**

```ts
// Prisma schema (DB source of truth), client singleton, ledger helpers.
// PrismaClient is NEVER exposed outside this package as a constructor —
// consumers import the configured `prisma` singleton or PrismaService (apps/api).
export { prisma } from './client.js';
export { assertZeroSum } from './ledger.js';

// Re-export generated enums + types so consumers never import @prisma/client directly.
export {
  Role,
  OAuthProvider,
  Locale,
  Currency,
  VendorStatus,
  ApplicationStatus,
  ProductStatus,
  OrderStatus,
  SubOrderStatus,
  PaymentProvider,
  PaymentStatus,
  LedgerAccount,
  LedgerEntryType,
  CouponScope,
  DiscountType,
} from '@prisma/client';
export type { Prisma } from '@prisma/client';
```

- [ ] **Step 4: Generate client + typecheck**

Run: `cd packages/db && npx prisma generate && pnpm typecheck`
Expected: client generated; `tsc --noEmit` exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src
git commit -m "feat(db): add prisma client singleton, ledger invariant helper, public exports"
```

---

## Task 14: Idempotent seed

**Files:**

- Create: `packages/db/src/seed.ts`

- [ ] **Step 1: Write `packages/db/src/seed.ts`**

```ts
import { ulid } from 'ulid';
import { prisma } from './client.js';
import { Currency, Locale, Role, VendorStatus, ProductStatus } from '@prisma/client';

// Stable ids so re-running upserts the same rows (idempotent).
const IDS = {
  settings: 'settings_singleton',
  demoUser: 'user_demo_customer',
  vendorAOwner: 'user_vendor_a_owner',
  vendorBOwner: 'user_vendor_b_owner',
  vendorA: 'vendor_a',
  vendorB: 'vendor_b',
  walletA: 'wallet_a',
  walletB: 'wallet_b',
  catRoot: 'cat_root',
  catApparel: 'cat_apparel',
  productA1: 'product_a1',
  variantA1: 'variant_a1',
} as const;

async function main() {
  // Platform settings singleton.
  await prisma.platformSettings.upsert({
    where: { id: IDS.settings },
    update: {},
    create: {
      id: IDS.settings,
      commissionBps: 1000,
      holdPeriodDays: 7,
      refundWindowDays: 7,
      maxCouponStack: 1,
      supportedCurrencies: [Currency.VND, Currency.USD],
      defaultCurrency: Currency.VND,
    },
  });

  // Demo customer.
  await prisma.user.upsert({
    where: { id: IDS.demoUser },
    update: {},
    create: {
      id: IDS.demoUser,
      email: 'customer@example.com',
      name: 'Demo Customer',
      primaryLocale: Locale.VI,
      roles: { create: { id: ulid(), role: Role.CUSTOMER } },
    },
  });

  // Two vendor owners + vendors + wallets + VENDOR_OWNER role.
  for (const v of [
    {
      owner: IDS.vendorAOwner,
      vendor: IDS.vendorA,
      wallet: IDS.walletA,
      slug: 'vendor-a',
      name: 'Vendor A',
    },
    {
      owner: IDS.vendorBOwner,
      vendor: IDS.vendorB,
      wallet: IDS.walletB,
      slug: 'vendor-b',
      name: 'Vendor B',
    },
  ]) {
    await prisma.user.upsert({
      where: { id: v.owner },
      update: {},
      create: {
        id: v.owner,
        email: `${v.slug}@example.com`,
        name: `${v.name} Owner`,
        primaryLocale: Locale.VI,
      },
    });
    await prisma.vendor.upsert({
      where: { id: v.vendor },
      update: {},
      create: {
        id: v.vendor,
        ownerId: v.owner,
        slug: v.slug,
        displayName: v.name,
        status: VendorStatus.ACTIVE,
      },
    });
    await prisma.userRole.upsert({
      where: {
        userId_role_vendorId: { userId: v.owner, role: Role.VENDOR_OWNER, vendorId: v.vendor },
      },
      update: {},
      create: { id: ulid(), userId: v.owner, role: Role.VENDOR_OWNER, vendorId: v.vendor },
    });
    await prisma.wallet.upsert({
      where: { id: v.wallet },
      update: {},
      create: { id: v.wallet, vendorId: v.vendor, balanceAmount: 0, balanceCurrency: Currency.VND },
    });
  }

  // Category tree with vi + en translations.
  await prisma.category.upsert({
    where: { id: IDS.catRoot },
    update: {},
    create: { id: IDS.catRoot, sortOrder: 0 },
  });
  await prisma.category.upsert({
    where: { id: IDS.catApparel },
    update: {},
    create: {
      id: IDS.catApparel,
      parentId: IDS.catRoot,
      sortOrder: 1,
      translations: {
        create: [
          { id: ulid(), locale: Locale.VI, name: 'Thời trang', slug: 'thoi-trang' },
          { id: ulid(), locale: Locale.EN, name: 'Apparel', slug: 'apparel' },
        ],
      },
    },
  });

  // One product on Vendor A, in Apparel, with one variant.
  await prisma.product.upsert({
    where: { id: IDS.productA1 },
    update: {},
    create: {
      id: IDS.productA1,
      vendorId: IDS.vendorA,
      status: ProductStatus.ACTIVE,
      basePriceAmount: 199_000,
      basePriceCurrency: Currency.VND,
      translations: {
        create: [
          {
            id: ulid(),
            locale: Locale.VI,
            name: 'Áo thun cơ bản',
            slug: 'ao-thun-co-ban',
            description: 'Áo thun cotton',
          },
          {
            id: ulid(),
            locale: Locale.EN,
            name: 'Basic Tee',
            slug: 'basic-tee',
            description: 'Cotton t-shirt',
          },
        ],
      },
      categories: { create: { categoryId: IDS.catApparel } },
      variants: {
        create: {
          id: IDS.variantA1,
          sku: 'TEE-BLK-M',
          attributes: { size: 'M', color: 'black' },
          priceAmount: 199_000,
          priceCurrency: Currency.VND,
          stockOnHand: 100,
          stockReserved: 0,
        },
      },
    },
  });

  console.info('Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Run the seed**

Run: `cd packages/db && pnpm seed`
Expected: prints `Seed complete.`, exit 0.

- [ ] **Step 3: Run it again (idempotency smoke)**

Run: `cd packages/db && pnpm seed`
Expected: prints `Seed complete.` again, exit 0, no unique-constraint error.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(db): add idempotent seed (settings, vendors, category, product)"
```

---

## Task 15: Vitest config + test setup

**Files:**

- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/test/setup.ts`

These tests hit a real Postgres. They use `DATABASE_URL` (point it at a throwaway test DB, e.g. `ecommerce_test`, or reuse local `ecommerce` — setup truncates between runs).

- [ ] **Step 1: Create `packages/db/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 2: Create `packages/db/test/setup.ts`**

```ts
import { execSync } from 'node:child_process';

// Apply migrations to the target DB before the suite runs.
export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/vitest.config.ts packages/db/test/setup.ts
git commit -m "test(db): add vitest config and migrate-deploy global setup"
```

---

## Task 16: Seed idempotency test

**Files:**

- Create: `packages/db/test/seed.idempotency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { prisma } from '../src/client.js';

describe('seed idempotency', () => {
  beforeAll(() => {
    execSync('pnpm seed', { stdio: 'inherit' });
    execSync('pnpm seed', { stdio: 'inherit' }); // second run must not duplicate
  });

  it('creates exactly one platform settings row', async () => {
    const count = await prisma.platformSettings.count();
    expect(count).toBe(1);
  });

  it('creates exactly two vendors', async () => {
    const count = await prisma.vendor.count();
    expect(count).toBe(2);
  });

  it('creates exactly one product variant', async () => {
    const count = await prisma.productVariant.count();
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd packages/db && pnpm test -- seed.idempotency`
Expected: PASS (seed.ts from Task 14 already idempotent). If counts are doubled, the upsert `where` keys are wrong — fix `seed.ts` to use the stable `IDS.*`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/seed.idempotency.test.ts
git commit -m "test(db): assert seed is idempotent across reruns"
```

---

## Task 17: Ledger zero-sum invariant test

**Files:**

- Create: `packages/db/test/ledger.invariant.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { assertZeroSum } from '../src/ledger.js';

describe('ledger zero-sum invariant', () => {
  it('accepts a balanced checkout posting (CUSTOMER -X / ESCROW +X)', () => {
    const g = 'grp_checkout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 199_000 },
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('accepts a balanced payout split (ESCROW -Y / WALLET +(Y-c) / REVENUE +c)', () => {
    const g = 'grp_payout_1';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 179_100 }, // 90%
      { txnGroupId: g, amount: 19_900 }, // 10% commission
    ];
    expect(() => assertZeroSum(entries)).not.toThrow();
  });

  it('throws when a group does not net to zero', () => {
    const g = 'grp_bad';
    const entries = [
      { txnGroupId: g, amount: -199_000 },
      { txnGroupId: g, amount: 198_000 },
    ];
    expect(() => assertZeroSum(entries)).toThrow(/sums to 1000/);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd packages/db && pnpm test -- ledger.invariant`
Expected: PASS (helper from Task 13). Note the throw message: amounts net to `-1000` (−199000 + 198000), so the message reads `sums to -1000` — if the regex `/sums to 1000/` fails, fix it to `/sums to -1000/`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/ledger.invariant.test.ts
git commit -m "test(db): assert ledger postings net to zero per txn group"
```

---

## Task 18: Wire workspace docs + final gate

**Files:**

- Create: `packages/db/CLAUDE.md`
- Modify: root `CLAUDE.md` implementation-status line (optional)

- [ ] **Step 1: Create `packages/db/CLAUDE.md`**

```markdown
# @repo/db

Prisma schema (DB source of truth), client singleton, ledger helpers, seed.

## State

- Schema: 27 models, 16 enums (identity, vendor/KYC, catalog+i18n, cart, orders, payment+ledger, coupons, reviews, settings, outbox).
- Migrations: `init` + `add_search_indexes` (pg_trgm + tsvector, hand-written SQL).
- Client: singleton in `src/client.ts`, exported as `prisma` from `src/index.ts`. NEVER export the `PrismaClient` constructor outside this package.
- IDs: ULID supplied at create-time (no DB default). Use `ulid()` from the `ulid` package.
- Money: paired `*_amount Int` + `*_currency Currency`. Never float.

## Commands

- `pnpm --filter @repo/db migrate` — migrate dev
- `pnpm --filter @repo/db seed` — idempotent seed
- `pnpm --filter @repo/db test` — vitest (needs local postgres via `pnpm services:up`)
```

- [ ] **Step 2: Full gate**

Run:

```bash
cd packages/db && npx prisma validate && pnpm typecheck && pnpm test
```

Expected: schema valid; typecheck exits 0; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/db/CLAUDE.md
git commit -m "docs(db): document @repo/db state and commands"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** All 9 spec modules → Tasks 2–10. Migrations → 11–12. Double-entry ledger + invariant → 7, 13, 17. ProductTranslation i18n → 4. Single-stock-per-variant → 4 (`stockOnHand`/`stockReserved`). Per-category commission → `Category.commissionBpsOverride` + `Vendor.commissionBpsOverride` + `PlatformSettings.commissionBps` (Tasks 3, 4, 10). 7/7 hold/refund → seed + PlatformSettings defaults (Tasks 10, 14). KYC 4 fields → Task 3. Seed idempotent → 14, 16. Search indexes → 12.
- **Type consistency:** `assertZeroSum` signature (Task 13) matches its tests (Task 17). `IDS` stable-id pattern (Task 14) matches idempotency assertions (Task 16). Enum names match `@prisma/client` re-exports (Task 13).
- **Known soft spots the executor must watch:** (1) Task 11 table count is an approximation — accept ≥26. (2) Task 12 generated `tsvector` column may trigger Prisma drift detection; the note gives the `Unsupported(...)` fallback. (3) Tests need `pnpm services:up` and a reachable `DATABASE_URL`; CI must provision Postgres before `pnpm --filter @repo/db test`.

```

```
