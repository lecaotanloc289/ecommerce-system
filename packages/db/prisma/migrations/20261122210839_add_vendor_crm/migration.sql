-- CreateEnum
CREATE TYPE "CrmMessageKind" AS ENUM ('SERVICE', 'MARKETING');

-- CreateEnum
CREATE TYPE "CrmChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "CrmAutomationKind" AS ENUM ('THANK_YOU', 'REVIEW_REQUEST', 'REORDER_REMINDER');

-- CreateEnum
CREATE TYPE "CrmCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrmMessageStatus" AS ENUM ('SCHEDULED', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('STOREFRONT', 'CHECKOUT', 'UNSUBSCRIBE_LINK');

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "crm_at_risk_after_days" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "crm_lapsed_after_days" INTEGER NOT NULL DEFAULT 180,
ADD COLUMN     "crm_max_campaigns_per_week" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "crm_max_marketing_per_customer_per_week" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "crm_vip_min_orders" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "vendor_customers" (
    "vendor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_customers_pkey" PRIMARY KEY ("vendor_id","user_id")
);

-- CreateTable
CREATE TABLE "vendor_customer_notes" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vendor_customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_vendor_preferences" (
    "user_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "marketing_opt_in_at" TIMESTAMP(3),
    "marketing_opt_in_source" "ConsentSource",
    "marketing_opt_out_at" TIMESTAMP(3),
    "service_opt_out_at" TIMESTAMP(3),
    "unsubscribe_token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_vendor_preferences_pkey" PRIMARY KEY ("user_id","vendor_id")
);

-- CreateTable
CREATE TABLE "crm_automations" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "kind" "CrmAutomationKind" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "delay_days" INTEGER NOT NULL,
    "template_vi" TEXT,
    "template_en" TEXT,
    "coupon_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_campaigns" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CrmCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" JSONB NOT NULL,
    "template_vi" TEXT NOT NULL,
    "template_en" TEXT,
    "coupon_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_messages" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "CrmMessageKind" NOT NULL,
    "automation_kind" "CrmAutomationKind",
    "campaign_id" TEXT,
    "sub_order_id" TEXT,
    "channels" "CrmChannel"[],
    "status" "CrmMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "skip_reason" TEXT,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "notification_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link_path" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_customers_tags_idx" ON "vendor_customers" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "vendor_customer_notes_vendor_id_user_id_created_at_idx" ON "vendor_customer_notes"("vendor_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_vendor_preferences_unsubscribe_token_hash_key" ON "customer_vendor_preferences"("unsubscribe_token_hash");

-- CreateIndex
CREATE INDEX "customer_vendor_preferences_vendor_id_idx" ON "customer_vendor_preferences"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_automations_vendor_id_kind_key" ON "crm_automations"("vendor_id", "kind");

-- CreateIndex
CREATE INDEX "crm_campaigns_vendor_id_status_idx" ON "crm_campaigns"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "crm_campaigns_status_scheduled_at_idx" ON "crm_campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "crm_messages_status_scheduled_for_idx" ON "crm_messages"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "crm_messages_vendor_id_user_id_sent_at_idx" ON "crm_messages"("vendor_id", "user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_messages_campaign_id_user_id_key" ON "crm_messages"("campaign_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_messages_automation_kind_sub_order_id_key" ON "crm_messages"("automation_kind", "sub_order_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "sub_orders_vendor_id_status_idx" ON "sub_orders"("vendor_id", "status");

-- AddForeignKey
ALTER TABLE "vendor_customers" ADD CONSTRAINT "vendor_customers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_customers" ADD CONSTRAINT "vendor_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_customer_notes" ADD CONSTRAINT "vendor_customer_notes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_customer_notes" ADD CONSTRAINT "vendor_customer_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_customer_notes" ADD CONSTRAINT "vendor_customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vendor_preferences" ADD CONSTRAINT "customer_vendor_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_vendor_preferences" ADD CONSTRAINT "customer_vendor_preferences_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
