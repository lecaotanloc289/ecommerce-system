-- Marketplace ops fields for every later roadmap wave (payment session, sub-order fulfilment,
-- platform coupon share, moderation reasons, outbox backoff, refunds, vendor staff invitations).
-- All additions are nullable or defaulted, so existing rows stay valid; the only drop is the
-- outbox (processed_at) index, superseded by (processed_at, next_attempt_at) which covers it.
--
-- Hand-edited (see packages/db/CLAUDE.md "Search-index drift"): `prisma migrate dev` also
-- generated DROP INDEX for the hand-written GIN/trigram search indexes and
-- `ALTER COLUMN "search_vector" DROP DEFAULT`. Those statements were removed. The partial unique
-- index at the end is hand-written (Prisma cannot model a WHERE clause).

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'BLOCKED';

-- DropIndex
DROP INDEX "outbox_events_processed_at_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_deadline_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "redirect_url" TEXT;

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "payment_timeout_minutes" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "blocked_reason" TEXT;

-- AlterTable
ALTER TABLE "sub_orders" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "platform_discount_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shipped_at" TIMESTAMP(3),
ADD COLUMN     "tracking_number" TEXT;

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "suspended_reason" TEXT;

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invitations" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refunds_sub_order_id_idx" ON "refunds"("sub_order_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_requested_by_id_idx" ON "refunds"("requested_by_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invitations_token_hash_key" ON "vendor_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "vendor_invitations_vendor_id_idx" ON "vendor_invitations"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_invitations_invited_by_id_idx" ON "vendor_invitations"("invited_by_id");

-- CreateIndex
CREATE INDEX "vendor_invitations_accepted_by_id_idx" ON "vendor_invitations"("accepted_by_id");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_next_attempt_at_idx" ON "outbox_events"("processed_at", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invitations" ADD CONSTRAINT "vendor_invitations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (hand-written): at most one non-FAILED refund per sub-order, so a full refund
-- (roadmap D12) cannot be requested twice concurrently. A FAILED attempt may be retried.
CREATE UNIQUE INDEX "refunds_sub_order_id_active_key" ON "refunds"("sub_order_id") WHERE "status" <> 'FAILED';
