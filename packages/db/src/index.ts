// Prisma schema (DB source of truth), client singleton, ledger + money boundary helpers.
// PrismaClient is NEVER exposed outside this package as a constructor —
// consumers import the configured `prisma` singleton or PrismaService (apps/api).
export { prisma } from './client.js';
export { assertZeroSum } from './ledger.js';
export { toMoney, toDbAmount } from './money.js';
export {
  crmAudienceIds,
  crmAudienceParams,
  crmSegmentCutoffs,
  crmSegmentThresholds,
} from './crm.js';

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
  RefundStatus,
  LedgerAccount,
  LedgerEntryType,
  CouponScope,
  DiscountType,
  CrmMessageKind,
  CrmChannel,
  CrmAutomationKind,
  CrmCampaignStatus,
  CrmMessageStatus,
  ConsentSource,
  ConsentAction,
  ZaloAccountStatus,
  ZaloMessageEvent,
  ZaloMessageStatus,
} from '@prisma/client';
export type { Prisma } from '@prisma/client';
