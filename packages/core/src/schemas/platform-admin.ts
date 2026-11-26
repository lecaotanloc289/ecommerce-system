import { z } from 'zod';
import {
  OrderStatusSchema,
  PaymentProviderSchema,
  PaymentStatusSchema,
  ProductStatusSchema,
  RoleSchema,
  VendorStatusSchema,
} from '../enums';
import {
  OrderIdSchema,
  PaymentIdSchema,
  ProductIdSchema,
  UserIdSchema,
  VendorIdSchema,
} from '../ids';
import { HttpUrlSchema, PageQuerySchema, PageSchema, SlugSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { NonNegativeMoneySchema } from './money';
import { OrderSchema } from './order';
import { RefundSchema } from './refund';
import { LedgerEntrySchema } from './wallet';

const requiredText = (max: number) => z.string().trim().min(1).max(max);
/** Free-text search box (`?q=`): trimmed, empty counts as absent. */
const SearchTextSchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/** Roles platform admins may grant / revoke through `/v1/platform/users/:id/roles`. */
export const PlatformRoleSchema = RoleSchema.extract(['PLATFORM_STAFF', 'PLATFORM_ADMIN']);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

// ---------------------------------------------------------------- vendors

/** Query of `GET /v1/platform/vendors`: `q` matches shop name, slug or owner email. */
export const PlatformVendorListQuerySchema = PageQuerySchema.extend({
  status: VendorStatusSchema.optional(),
  q: SearchTextSchema,
});
export type PlatformVendorListQuery = z.infer<typeof PlatformVendorListQuerySchema>;

export const PlatformVendorSchema = z.object({
  id: VendorIdSchema,
  slug: SlugSchema,
  displayName: z.string().min(1),
  status: VendorStatusSchema,
  suspendedReason: z.string().nullable(),
  commissionBpsOverride: z.number().int().nullable(),
  ownerId: UserIdSchema,
  ownerName: z.string(),
  ownerEmail: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PlatformVendor = z.infer<typeof PlatformVendorSchema>;

export const PlatformVendorPageSchema = PageSchema(PlatformVendorSchema);
export type PlatformVendorPage = z.infer<typeof PlatformVendorPageSchema>;

/** Body of `POST /v1/platform/vendors/:id/suspend`. */
export const PlatformVendorSuspendSchema = z.object({ reason: requiredText(500) });
export type PlatformVendorSuspend = z.infer<typeof PlatformVendorSuspendSchema>;

// ---------------------------------------------------------------- products

/** Query of `GET /v1/platform/products`: `q` matches product name / slug (either locale). */
export const PlatformProductListQuerySchema = PageQuerySchema.extend({
  status: ProductStatusSchema.optional(),
  vendorId: VendorIdSchema.optional(),
  q: SearchTextSchema,
});
export type PlatformProductListQuery = z.infer<typeof PlatformProductListQuerySchema>;

export const PlatformProductSchema = z.object({
  id: ProductIdSchema,
  vendorId: VendorIdSchema,
  vendorName: z.string().min(1),
  status: ProductStatusSchema,
  blockedReason: z.string().nullable(),
  /** Vietnamese name (the vendor's primary locale). */
  name: z.string(),
  basePrice: NonNegativeMoneySchema,
  primaryImageUrl: HttpUrlSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PlatformProduct = z.infer<typeof PlatformProductSchema>;

export const PlatformProductPageSchema = PageSchema(PlatformProductSchema);
export type PlatformProductPage = z.infer<typeof PlatformProductPageSchema>;

/** Body of `POST /v1/platform/products/:id/block`. */
export const PlatformProductBlockSchema = z.object({ reason: requiredText(500) });
export type PlatformProductBlock = z.infer<typeof PlatformProductBlockSchema>;

// ---------------------------------------------------------------- orders

/** Query of `GET /v1/platform/orders`: `q` = order id (prefix) or customer email (substring). */
export const PlatformOrderListQuerySchema = PageQuerySchema.extend({
  status: OrderStatusSchema.optional(),
  q: SearchTextSchema,
});
export type PlatformOrderListQuery = z.infer<typeof PlatformOrderListQuerySchema>;

export const PlatformOrderSummarySchema = z.object({
  id: OrderIdSchema,
  status: OrderStatusSchema,
  grandTotal: NonNegativeMoneySchema,
  subOrderCount: z.number().int().nonnegative(),
  customerId: UserIdSchema,
  customerName: z.string(),
  customerEmail: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PlatformOrderSummary = z.infer<typeof PlatformOrderSummarySchema>;

export const PlatformOrderPageSchema = PageSchema(PlatformOrderSummarySchema);
export type PlatformOrderPage = z.infer<typeof PlatformOrderPageSchema>;

/** Payment attempt as platform staff see it: the provider's raw payload is never exposed. */
export const PlatformPaymentSchema = z.object({
  id: PaymentIdSchema,
  attemptNo: z.number().int().min(1),
  provider: PaymentProviderSchema,
  status: PaymentStatusSchema,
  amount: NonNegativeMoneySchema,
  providerTxnId: z.string().nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PlatformPayment = z.infer<typeof PlatformPaymentSchema>;

/** `GET /v1/platform/orders/:id`: the customer view plus customer, payments, ledger and refunds. */
export const PlatformOrderDetailSchema = OrderSchema.extend({
  customerId: UserIdSchema,
  customerName: z.string(),
  customerEmail: z.string().nullable(),
  payments: z.array(PlatformPaymentSchema),
  ledgerEntries: z.array(LedgerEntrySchema),
  refunds: z.array(RefundSchema),
});
export type PlatformOrderDetail = z.infer<typeof PlatformOrderDetailSchema>;

// ---------------------------------------------------------------- users

/** Query of `GET /v1/platform/users`: `q` matches email or name (substring, case-insensitive). */
export const PlatformUserListQuerySchema = PageQuerySchema.extend({ q: SearchTextSchema });
export type PlatformUserListQuery = z.infer<typeof PlatformUserListQuerySchema>;

export const PlatformUserSchema = z.object({
  id: UserIdSchema,
  email: z.string().nullable(),
  name: z.string(),
  /** Distinct roles held (a vendor role appears once even when held on several vendors). */
  roles: z.array(RoleSchema),
  createdAt: IsoDateTimeSchema,
});
export type PlatformUser = z.infer<typeof PlatformUserSchema>;

export const PlatformUserPageSchema = PageSchema(PlatformUserSchema);
export type PlatformUserPage = z.infer<typeof PlatformUserPageSchema>;

/** Body of `POST /v1/platform/users/:id/roles` (admin only). */
export const PlatformRoleGrantSchema = z.object({ role: PlatformRoleSchema });
export type PlatformRoleGrant = z.infer<typeof PlatformRoleGrantSchema>;
