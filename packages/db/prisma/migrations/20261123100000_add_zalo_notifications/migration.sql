-- CreateEnum
CREATE TYPE "ZaloAccountStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ZaloMessageEvent" AS ENUM ('ORDER_PLACED', 'ORDER_PAID', 'ORDER_PROCESSING', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_COMPLETED', 'ORDER_CANCELLED', 'ORDER_REFUNDED', 'AFTER_DELIVERY');

-- CreateEnum
CREATE TYPE "ZaloMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "zalo_opt_in" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "zalo_accounts" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "status" "ZaloAccountStatus" NOT NULL,
    "zalo_uid" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "credentials" TEXT,
    "last_login_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zalo_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zalo_message_templates" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "event" "ZaloMessageEvent" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zalo_message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zalo_messages" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "sub_order_id" TEXT NOT NULL,
    "event" "ZaloMessageEvent" NOT NULL,
    "status" "ZaloMessageStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "skip_reason" TEXT,
    "rendered_body" TEXT,
    "zalo_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zalo_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zalo_accounts_vendor_id_key" ON "zalo_accounts"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "zalo_accounts_zalo_uid_key" ON "zalo_accounts"("zalo_uid");

-- CreateIndex
CREATE INDEX "zalo_accounts_status_idx" ON "zalo_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "zalo_message_templates_vendor_id_event_key" ON "zalo_message_templates"("vendor_id", "event");

-- CreateIndex
CREATE INDEX "zalo_messages_vendor_id_status_scheduled_at_idx" ON "zalo_messages"("vendor_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "zalo_messages_status_scheduled_at_idx" ON "zalo_messages"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "zalo_messages_sub_order_id_event_key" ON "zalo_messages"("sub_order_id", "event");

-- AddForeignKey
ALTER TABLE "zalo_accounts" ADD CONSTRAINT "zalo_accounts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_message_templates" ADD CONSTRAINT "zalo_message_templates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_messages" ADD CONSTRAINT "zalo_messages_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zalo_messages" ADD CONSTRAINT "zalo_messages_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

