-- Roadmap T2.2: the worker stores the provider session reference (VNPay refund needs it) and the
-- API stores the customer IP VNPay requires. Hand-edited: the generated search-index drift
-- statements (see packages/db/CLAUDE.md) were removed.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "client_ip" TEXT,
ADD COLUMN     "provider_ref" TEXT;
