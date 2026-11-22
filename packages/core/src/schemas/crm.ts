import { z } from 'zod';
import {
  CrmAutomationKindSchema,
  CrmCampaignStatusSchema,
  CrmMessageKindSchema,
  SubOrderStatusSchema,
} from '../enums';
import { CRM_COUPON_CODE_REGEX, assertCrmTemplate } from '../crm';
import { DomainError } from '../errors';
import {
  CouponIdSchema,
  CrmCampaignIdSchema,
  OrderIdSchema,
  ProductIdSchema,
  SubOrderIdSchema,
  UserIdSchema,
  VendorCustomerNoteIdSchema,
  VendorIdSchema,
} from '../ids';
import { PageQuerySchema, PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { MoneySchema } from './money';

// Vendor CRM (wave 7) — see docs/superpowers/plans/2026-11-23-vendor-crm.md §2.

/** Core-only (derived at read time, never stored): see `classifyCustomer`. */
export const CustomerSegmentSchema = z.enum(['NEW', 'RETURNING', 'VIP', 'AT_RISK', 'LAPSED']);
export type CustomerSegment = z.infer<typeof CustomerSegmentSchema>;
export const CustomerSegment = CustomerSegmentSchema.enum;

/** Core-only: why a scheduled `crm_messages` row was SKIPPED (stored as text). */
export const CrmSkipReasonSchema = z.enum([
  'VENDOR_INACTIVE',
  'AUTOMATION_DISABLED',
  'NO_CONSENT',
  'OPTED_OUT',
  'FREQUENCY_CAP',
  'ALREADY_REVIEWED',
  'ALREADY_REORDERED',
  'ORDER_REFUNDED',
  'NO_CHANNEL',
  'CAMPAIGN_CANCELLED',
]);
export type CrmSkipReason = z.infer<typeof CrmSkipReasonSchema>;
export const CrmSkipReason = CrmSkipReasonSchema.enum;

export const CRM_TEMPLATE_MAX_LENGTH = 1000;
export const CRM_MAX_TAGS = 10;
export const CRM_TAG_MAX_LENGTH = 30;
export const CRM_NOTE_MAX_LENGTH = 2000;
export const CRM_MAX_CAMPAIGN_AHEAD_DAYS = 30;

/** Shop-authored text: plain, ≤ 1000 chars, known placeholders only, no links (C7). */
export const CrmTemplateTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(CRM_TEMPLATE_MAX_LENGTH)
  .superRefine((text, ctx) => {
    try {
      assertCrmTemplate(text);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      ctx.addIssue({ code: 'custom', message: error.code, params: error.params });
    }
  });
export type CrmTemplateText = z.infer<typeof CrmTemplateTextSchema>;

/** Coupon code safe to embed in CRM messages (see `assertCrmCouponCode`). */
export const CrmCouponCodeSchema = z.string().regex(CRM_COUPON_CODE_REGEX);
export type CrmCouponCode = z.infer<typeof CrmCouponCodeSchema>;

export const CrmTagSchema = z
  .string()
  .normalize('NFC')
  .trim()
  .toLowerCase()
  .min(1)
  .max(CRM_TAG_MAX_LENGTH)
  .refine((t) => !/\p{C}/u.test(t), { message: 'Control characters not allowed' });
export type CrmTag = z.infer<typeof CrmTagSchema>;

const uniqueItems = (items: readonly string[]): boolean => new Set(items).size === items.length;

// --- Requests (never carry the caller's vendorId / userId) -------------------------------------

/** `cursor` is opaque (server encodes sort key + customer id), not a ULID. */
export const CrmCustomerListQuerySchema = PageQuerySchema.extend({
  cursor: z.string().min(1).max(200).optional(),
  segment: CustomerSegmentSchema.optional(),
  tag: CrmTagSchema.optional(),
  q: z.string().trim().max(100).optional(),
  productId: ProductIdSchema.optional(),
  sort: z.enum(['last_order', 'order_count']).optional(),
});
export type CrmCustomerListQuery = z.infer<typeof CrmCustomerListQuerySchema>;

export const ReplaceCustomerTagsSchema = z.object({
  tags: z.array(CrmTagSchema).max(CRM_MAX_TAGS).refine(uniqueItems, { message: 'Duplicate tags' }),
});
export type ReplaceCustomerTags = z.infer<typeof ReplaceCustomerTagsSchema>;

export const CreateCustomerNoteSchema = z.object({
  body: z.string().trim().min(1).max(CRM_NOTE_MAX_LENGTH),
});
export type CreateCustomerNote = z.infer<typeof CreateCustomerNoteSchema>;

/** `delayDays` range per `kind` (C8) and `couponId` only for REORDER_REMINDER are checked server-side. */
export const UpdateCrmAutomationSchema = z.object({
  isEnabled: z.boolean(),
  delayDays: z.number().int().min(0).max(180),
  templateVi: CrmTemplateTextSchema.nullable(),
  templateEn: CrmTemplateTextSchema.nullable(),
  couponId: CouponIdSchema.nullable(),
});
export type UpdateCrmAutomation = z.infer<typeof UpdateCrmAutomationSchema>;

/** Empty array = no filter on that criterion. */
export const CrmAudienceFilterSchema = z.object({
  segments: z
    .array(CustomerSegmentSchema)
    .max(5)
    .refine(uniqueItems, { message: 'Duplicate segments' }),
  tags: z.array(CrmTagSchema).max(CRM_MAX_TAGS).refine(uniqueItems, { message: 'Duplicate tags' }),
  boughtProductIds: z
    .array(ProductIdSchema)
    .max(20)
    .refine(uniqueItems, { message: 'Duplicate products' }),
  lastOrderWithinDays: z.number().int().min(1).max(730).nullable(),
});
export type CrmAudienceFilter = z.infer<typeof CrmAudienceFilterSchema>;

const crmCampaignBody = {
  name: z.string().trim().min(1).max(120),
  audience: CrmAudienceFilterSchema,
  templateVi: CrmTemplateTextSchema,
  templateEn: CrmTemplateTextSchema.nullable(),
  couponId: CouponIdSchema.nullable(),
};

export const CreateCrmCampaignSchema = z.object(crmCampaignBody);
export type CreateCrmCampaign = z.infer<typeof CreateCrmCampaignSchema>;

export const UpdateCrmCampaignSchema = z.object(crmCampaignBody);
export type UpdateCrmCampaign = z.infer<typeof UpdateCrmCampaignSchema>;

/** `scheduledAt: null` = send now. The "≤ 30 days ahead / not in the past" check uses the server clock. */
export const ScheduleCrmCampaignSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
});
export type ScheduleCrmCampaign = z.infer<typeof ScheduleCrmCampaignSchema>;

export const CancelCrmCampaignSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CancelCrmCampaign = z.infer<typeof CancelCrmCampaignSchema>;

export const UpdateVendorPreferenceSchema = z
  .object({
    marketingOptIn: z.boolean().optional(),
    serviceOptOut: z.boolean().optional(),
  })
  .refine((v) => v.marketingOptIn !== undefined || v.serviceOptOut !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateVendorPreference = z.infer<typeof UpdateVendorPreferenceSchema>;

/** 32 random bytes, base64url without padding = 43 chars. */
export const UNSUBSCRIBE_TOKEN_LENGTH = 43;
export const UnsubscribeSchema = z.object({
  token: z
    .string()
    .length(UNSUBSCRIBE_TOKEN_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
  scope: z.enum(['MARKETING', 'ALL']),
});
export type Unsubscribe = z.infer<typeof UnsubscribeSchema>;

/** Platform staff list filter: `GET /v1/platform/crm/campaigns?vendorId=&status=`. */
export const PlatformCrmCampaignListQuerySchema = PageQuerySchema.extend({
  vendorId: VendorIdSchema.optional(),
  status: CrmCampaignStatusSchema.optional(),
});
export type PlatformCrmCampaignListQuery = z.infer<typeof PlatformCrmCampaignListQuerySchema>;

// --- Read models -------------------------------------------------------------------------------
// No email / phone / street address, ever (C4).

export const CrmCustomerSummarySchema = z.object({
  customerId: UserIdSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  province: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  firstOrderAt: IsoDateTimeSchema,
  lastOrderAt: IsoDateTimeSchema,
  /** Σ paid amount on valid orders, grouped by currency (C2). */
  spend: z.array(MoneySchema),
  segment: CustomerSegmentSchema,
  tags: z.array(z.string()),
  marketingOptIn: z.boolean(),
});
export type CrmCustomerSummary = z.infer<typeof CrmCustomerSummarySchema>;

export const CrmCustomerPageSchema = z.object({
  items: z.array(CrmCustomerSummarySchema),
  nextCursor: z.string().min(1).max(200).nullable(),
});
export type CrmCustomerPage = z.infer<typeof CrmCustomerPageSchema>;

export const CrmCustomerDetailSchema = CrmCustomerSummarySchema.extend({
  serviceOptOut: z.boolean(),
  recentOrders: z
    .array(
      z.object({
        subOrderId: SubOrderIdSchema,
        orderId: OrderIdSchema,
        status: SubOrderStatusSchema,
        createdAt: IsoDateTimeSchema,
        total: MoneySchema,
        itemTitles: z.array(z.string()),
      }),
    )
    .max(20),
  reviews: z
    .array(
      z.object({
        productId: ProductIdSchema,
        rating: z.number().int().min(1).max(5),
        body: z.string().nullable(),
        createdAt: IsoDateTimeSchema,
      }),
    )
    .max(20),
  notes: z
    .array(
      z.object({
        id: VendorCustomerNoteIdSchema,
        authorName: z.string(),
        body: z.string(),
        createdAt: IsoDateTimeSchema,
      }),
    )
    .max(50),
});
export type CrmCustomerDetail = z.infer<typeof CrmCustomerDetailSchema>;

export const CrmSegmentCountsSchema = z.object({
  segments: z.array(
    z.object({
      segment: CustomerSegmentSchema,
      customers: z.number().int().nonnegative(),
      marketingOptedIn: z.number().int().nonnegative(),
    }),
  ),
  totalCustomers: z.number().int().nonnegative(),
});
export type CrmSegmentCounts = z.infer<typeof CrmSegmentCountsSchema>;

export const CrmAutomationSchema = z.object({
  kind: CrmAutomationKindSchema,
  messageKind: CrmMessageKindSchema,
  isEnabled: z.boolean(),
  delayDays: z.number().int().nonnegative(),
  templateVi: z.string().nullable(),
  templateEn: z.string().nullable(),
  couponId: CouponIdSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type CrmAutomation = z.infer<typeof CrmAutomationSchema>;

export const CrmCampaignSchema = z.object({
  id: CrmCampaignIdSchema,
  name: z.string(),
  status: CrmCampaignStatusSchema,
  audience: CrmAudienceFilterSchema,
  templateVi: z.string(),
  templateEn: z.string().nullable(),
  couponId: CouponIdSchema.nullable(),
  scheduledAt: IsoDateTimeSchema.nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  recipientCount: z.number().int().nonnegative(),
  createdAt: IsoDateTimeSchema,
  stats: z.object({
    sent: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    couponRedemptions: z.number().int().nonnegative(),
  }),
});
export type CrmCampaign = z.infer<typeof CrmCampaignSchema>;

export const CrmCampaignPageSchema = PageSchema(CrmCampaignSchema);
export type CrmCampaignPage = z.infer<typeof CrmCampaignPageSchema>;

export const CrmCampaignPreviewSchema = z.object({
  matchedCustomers: z.number().int().nonnegative(),
  eligibleRecipients: z.number().int().nonnegative(),
  sample: z.object({ vi: z.string(), en: z.string() }),
});
export type CrmCampaignPreview = z.infer<typeof CrmCampaignPreviewSchema>;

export const VendorPreferenceSchema = z.object({
  vendorId: VendorIdSchema,
  vendorName: z.string(),
  marketingOptIn: z.boolean(),
  serviceOptOut: z.boolean(),
  updatedAt: IsoDateTimeSchema,
});
export type VendorPreference = z.infer<typeof VendorPreferenceSchema>;
