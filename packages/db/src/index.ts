// Prisma schema (DB source of truth), client singleton, ledger + money boundary helpers.
// PrismaClient is NEVER exposed outside this package as a constructor —
// consumers import the configured `prisma` singleton or PrismaService (apps/api).
export { prisma } from './client.js';
export { assertZeroSum } from './ledger.js';
export { toMoney, toDbAmount } from './money.js';

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
} from '@prisma/client';
export type { Prisma } from '@prisma/client';
