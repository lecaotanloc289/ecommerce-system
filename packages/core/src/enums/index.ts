import { z } from 'zod';

// Mirrors of the Prisma enums in packages/db/prisma/schema.prisma.
// Values MUST match Prisma exactly — test/enums.test.ts parses the schema file and fails on drift.
// core never imports @repo/db (dependency direction: core → db, not the reverse).
//
// Each enum exports three things with the same name stem:
//   RoleSchema  — Zod schema (validation)
//   Role        — type (z.infer) AND value object (`Role.CUSTOMER`), like Prisma's $Enums

export const RoleSchema = z.enum([
  'GUEST',
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_STAFF',
  'PLATFORM_STAFF',
  'PLATFORM_ADMIN',
]);
export type Role = z.infer<typeof RoleSchema>;
export const Role = RoleSchema.enum;

export const OAuthProviderSchema = z.enum(['GOOGLE', 'FACEBOOK']);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;
export const OAuthProvider = OAuthProviderSchema.enum;

export const LocaleSchema = z.enum(['VI', 'EN']);
export type Locale = z.infer<typeof LocaleSchema>;
export const Locale = LocaleSchema.enum;

export const CurrencySchema = z.enum(['VND', 'USD']);
export type Currency = z.infer<typeof CurrencySchema>;
export const Currency = CurrencySchema.enum;

export const VendorStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']);
export type VendorStatus = z.infer<typeof VendorStatusSchema>;
export const VendorStatus = VendorStatusSchema.enum;

export const ApplicationStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export const ApplicationStatus = ApplicationStatusSchema.enum;

export const ProductStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export const ProductStatus = ProductStatusSchema.enum;

export const OrderStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CANCELLED',
  'COMPLETED',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export const OrderStatus = OrderStatusSchema.enum;

export const SubOrderStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'REFUNDED',
  'CANCELLED',
]);
export type SubOrderStatus = z.infer<typeof SubOrderStatusSchema>;
export const SubOrderStatus = SubOrderStatusSchema.enum;

export const PaymentProviderSchema = z.enum(['VNPAY', 'STRIPE']);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;
export const PaymentProvider = PaymentProviderSchema.enum;

export const PaymentStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export const PaymentStatus = PaymentStatusSchema.enum;

export const LedgerAccountSchema = z.enum([
  'CUSTOMER',
  'PLATFORM_ESCROW',
  'VENDOR_WALLET',
  'PLATFORM_REVENUE',
]);
export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;
export const LedgerAccount = LedgerAccountSchema.enum;

export const LedgerEntryTypeSchema = z.enum([
  'ESCROW_IN',
  'PAYOUT_OUT',
  'COMMISSION',
  'REFUND',
  'ADJUSTMENT',
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;
export const LedgerEntryType = LedgerEntryTypeSchema.enum;

export const CouponScopeSchema = z.enum(['PLATFORM', 'VENDOR']);
export type CouponScope = z.infer<typeof CouponScopeSchema>;
export const CouponScope = CouponScopeSchema.enum;

export const DiscountTypeSchema = z.enum(['PERCENT', 'FIXED']);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;
export const DiscountType = DiscountTypeSchema.enum;
