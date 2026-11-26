-- Additive live-shopping tables. Hand-edited (see packages/db/CLAUDE.md "Search-index drift"):
-- `migrate dev` also generated DROP INDEX for the GIN/trigram search indexes and
-- `ALTER COLUMN "search_vector" DROP DEFAULT`; those statements were removed.

-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiveEndReason" AS ENUM ('VENDOR', 'DISCONNECT_TIMEOUT', 'TERMINATED');

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "live_chat_cooldown_seconds" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "live_disconnect_grace_seconds" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3),
    "live_input_id" TEXT,
    "encoder_connected_at" TIMESTAMP(3),
    "encoder_disconnected_at" TIMESTAMP(3),
    "encoder_status_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" "LiveEndReason",
    "end_note" TEXT,
    "recording_video_id" TEXT,
    "peak_viewers" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_session_products" (
    "live_session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pinned_at" TIMESTAMP(3),

    CONSTRAINT "live_session_products_pkey" PRIMARY KEY ("live_session_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_live_input_id_key" ON "live_sessions"("live_input_id");

-- CreateIndex
CREATE INDEX "live_sessions_vendor_id_status_idx" ON "live_sessions"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "live_sessions_status_started_at_idx" ON "live_sessions"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_vendor_id_idempotency_key_key" ON "live_sessions"("vendor_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "live_session_products_product_id_idx" ON "live_session_products"("product_id");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_products" ADD CONSTRAINT "live_session_products_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_products" ADD CONSTRAINT "live_session_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
