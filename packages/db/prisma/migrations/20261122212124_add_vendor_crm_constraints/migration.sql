-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('MARKETING_OPT_IN', 'MARKETING_OPT_OUT', 'SERVICE_OPT_OUT', 'SERVICE_OPT_IN');

-- DropForeignKey
ALTER TABLE "crm_campaigns" DROP CONSTRAINT "crm_campaigns_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "crm_messages" DROP CONSTRAINT "crm_messages_sub_order_id_fkey";

-- DropForeignKey
ALTER TABLE "vendor_customer_notes" DROP CONSTRAINT "vendor_customer_notes_author_id_fkey";

-- DropIndex (replaced by the hand-written partial index crm_messages_due_idx below)
DROP INDEX "crm_messages_status_scheduled_for_idx";

-- AlterTable
ALTER TABLE "crm_campaigns" ALTER COLUMN "created_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vendor_customer_notes" ALTER COLUMN "author_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "crm_consent_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_consent_events_user_id_vendor_id_created_at_idx" ON "crm_consent_events"("user_id", "vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_consent_events_vendor_id_idx" ON "crm_consent_events"("vendor_id");

-- CreateIndex
CREATE INDEX "crm_automations_coupon_id_idx" ON "crm_automations"("coupon_id");

-- CreateIndex
CREATE INDEX "crm_campaigns_created_by_id_idx" ON "crm_campaigns"("created_by_id");

-- CreateIndex
CREATE INDEX "crm_campaigns_coupon_id_idx" ON "crm_campaigns"("coupon_id");

-- CreateIndex
CREATE INDEX "crm_messages_user_id_idx" ON "crm_messages"("user_id");

-- CreateIndex
CREATE INDEX "crm_messages_sub_order_id_idx" ON "crm_messages"("sub_order_id");

-- CreateIndex
CREATE INDEX "crm_messages_notification_id_idx" ON "crm_messages"("notification_id");

-- CreateIndex
CREATE INDEX "notifications_vendor_id_idx" ON "notifications"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_customer_notes_user_id_idx" ON "vendor_customer_notes"("user_id");

-- CreateIndex
CREATE INDEX "vendor_customer_notes_author_id_idx" ON "vendor_customer_notes"("author_id");

-- CreateIndex
CREATE INDEX "vendor_customers_user_id_idx" ON "vendor_customers"("user_id");

-- AddForeignKey
ALTER TABLE "vendor_customer_notes" ADD CONSTRAINT "vendor_customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (Prisma cannot model partial indexes or CHECK constraints; see packages/db/CLAUDE.md drift warning)

-- Worker scan for due messages: only SCHEDULED rows are ever scanned by scheduled_for.
CREATE INDEX "crm_messages_due_idx" ON "crm_messages" ("scheduled_for") WHERE "status" = 'SCHEDULED';

-- A message comes from exactly one source: a campaign, or an automation tied to a sub-order.
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_source_check" CHECK (
  ("campaign_id" IS NOT NULL AND "automation_kind" IS NULL AND "sub_order_id" IS NULL)
  OR ("campaign_id" IS NULL AND "automation_kind" IS NOT NULL AND "sub_order_id" IS NOT NULL)
);

-- CRM tunables stay sane: 1..3650 days / counts, and at-risk must come before lapsed.
ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_crm_at_risk_after_days_check" CHECK ("crm_at_risk_after_days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "platform_settings_crm_lapsed_after_days_check" CHECK ("crm_lapsed_after_days" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "platform_settings_crm_vip_min_orders_check" CHECK ("crm_vip_min_orders" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "platform_settings_crm_max_campaigns_per_week_check" CHECK ("crm_max_campaigns_per_week" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "platform_settings_crm_max_marketing_per_customer_per_week_check" CHECK ("crm_max_marketing_per_customer_per_week" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "platform_settings_crm_at_risk_before_lapsed_check" CHECK ("crm_at_risk_after_days" < "crm_lapsed_after_days");
