-- Widen every money column from int4 to int8 (BIGINT). int4 caps at 2,147,483,647 minor
-- units (~2.1B VND), which a large order or a vendor wallet balance can exceed; @repo/core Money
-- allows up to Number.MAX_SAFE_INTEGER. int4 → int8 is lossless (no value can change), though Postgres
-- rewrites each table under an ACCESS EXCLUSIVE lock — cheap pre-launch, plan a window once data is large.
--
-- Hand-edited (see packages/db/CLAUDE.md "Search-index drift"): `prisma migrate dev` also
-- generated DROP INDEX for the hand-written GIN/trigram search indexes and
-- `ALTER COLUMN "search_vector" DROP DEFAULT` on the generated tsvector column. Those statements
-- were removed — only the BIGINT widenings below are intended.

-- AlterTable
ALTER TABLE "coupon_redemptions" ALTER COLUMN "discount_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "coupons" ALTER COLUMN "discount_value" SET DATA TYPE BIGINT,
ALTER COLUMN "min_spend_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "unit_price_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "line_total_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "items_total_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "shipping_total_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "discount_total_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "grand_total_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "product_variants" ALTER COLUMN "price_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "base_price_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "shipping_methods" ALTER COLUMN "price_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "sub_orders" ALTER COLUMN "subtotal_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "shipping_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "discount_amount" SET DATA TYPE BIGINT,
ALTER COLUMN "commission_amount" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "wallets" ALTER COLUMN "balance_amount" SET DATA TYPE BIGINT;
