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

export const ProductStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED', 'BLOCKED']);
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

export const RefundStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;
export const RefundStatus = RefundStatusSchema.enum;

// CRM (vendor customer care) — wave 7.
export const CrmMessageKindSchema = z.enum(['SERVICE', 'MARKETING']);
export type CrmMessageKind = z.infer<typeof CrmMessageKindSchema>;
export const CrmMessageKind = CrmMessageKindSchema.enum;

export const CrmChannelSchema = z.enum(['IN_APP', 'EMAIL']);
export type CrmChannel = z.infer<typeof CrmChannelSchema>;
export const CrmChannel = CrmChannelSchema.enum;

export const CrmAutomationKindSchema = z.enum(['THANK_YOU', 'REVIEW_REQUEST', 'REORDER_REMINDER']);
export type CrmAutomationKind = z.infer<typeof CrmAutomationKindSchema>;
export const CrmAutomationKind = CrmAutomationKindSchema.enum;

export const CrmCampaignStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
]);
export type CrmCampaignStatus = z.infer<typeof CrmCampaignStatusSchema>;
export const CrmCampaignStatus = CrmCampaignStatusSchema.enum;

export const CrmMessageStatusSchema = z.enum(['SCHEDULED', 'SENT', 'SKIPPED', 'FAILED']);
export type CrmMessageStatus = z.infer<typeof CrmMessageStatusSchema>;
export const CrmMessageStatus = CrmMessageStatusSchema.enum;

export const ConsentSourceSchema = z.enum(['STOREFRONT', 'CHECKOUT', 'UNSUBSCRIBE_LINK']);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;
export const ConsentSource = ConsentSourceSchema.enum;

export const ConsentActionSchema = z.enum([
  'MARKETING_OPT_IN',
  'MARKETING_OPT_OUT',
  'SERVICE_OPT_OUT',
  'SERVICE_OPT_IN',
]);
export type ConsentAction = z.infer<typeof ConsentActionSchema>;
export const ConsentAction = ConsentActionSchema.enum;
export const ZaloAccountStatusSchema = z.enum(['ACTIVE', 'EXPIRED', 'DISCONNECTED']);
export type ZaloAccountStatus = z.infer<typeof ZaloAccountStatusSchema>;
export const ZaloAccountStatus = ZaloAccountStatusSchema.enum;

export const ZaloMessageEventSchema = z.enum([
  'ORDER_PLACED',
  'ORDER_PAID',
  'ORDER_PROCESSING',
  'ORDER_SHIPPED',
  'ORDER_DELIVERED',
  'ORDER_COMPLETED',
  'ORDER_CANCELLED',
  'ORDER_REFUNDED',
  'AFTER_DELIVERY',
]);
export type ZaloMessageEvent = z.infer<typeof ZaloMessageEventSchema>;
export const ZaloMessageEvent = ZaloMessageEventSchema.enum;

export const ZaloMessageStatusSchema = z.enum(['PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED']);
export type ZaloMessageStatus = z.infer<typeof ZaloMessageStatusSchema>;
export const ZaloMessageStatus = ZaloMessageStatusSchema.enum;
export const LiveSessionStatusSchema = z.enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']);
export type LiveSessionStatus = z.infer<typeof LiveSessionStatusSchema>;
export const LiveSessionStatus = LiveSessionStatusSchema.enum;

export const LiveEndReasonSchema = z.enum(['VENDOR', 'DISCONNECT_TIMEOUT', 'TERMINATED']);
export type LiveEndReason = z.infer<typeof LiveEndReasonSchema>;
export const LiveEndReason = LiveEndReasonSchema.enum;
