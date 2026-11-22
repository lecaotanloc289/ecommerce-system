import { z } from 'zod';
import { ApplicationStatusSchema } from '../enums';
import { UserIdSchema, VendorApplicationIdSchema, VendorIdSchema } from '../ids';
import { HttpUrlSchema, PageQuerySchema, PageSchema, SlugSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { UploadKeySchema } from './upload';

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Public shop card/page header (`GET /v1/vendors/:slug`). Never exposes status, KYC or commission. */
export const VendorPublicSchema = z.object({
  id: VendorIdSchema,
  slug: SlugSchema,
  displayName: z.string().min(1),
  logoUrl: HttpUrlSchema.nullable(),
  description: z.string().nullable(),
});
export type VendorPublic = z.infer<typeof VendorPublicSchema>;

/**
 * Body of `POST /v1/vendor-applications`. Documents are referenced by the `kyc` upload keys from
 * `POST /v1/uploads/presign` — the server checks each key belongs to the caller. The applicant
 * comes from the access token, never the body.
 */
export const VendorApplicationCreateSchema = z.object({
  businessLicenseKey: UploadKeySchema,
  taxId: requiredText(32),
  nationalIdNumber: requiredText(32),
  nationalIdKey: UploadKeySchema,
  bankName: requiredText(120),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,24}$/, { message: 'Invalid bank account number' }),
  accountHolder: requiredText(120),
});
export type VendorApplicationCreate = z.infer<typeof VendorApplicationCreateSchema>;

/**
 * Application as returned to the applicant and platform staff. Document keys point into the
 * private `kyc` bucket; staff read them through presigned GET URLs, never public links.
 */
export const VendorApplicationSchema = z.object({
  id: VendorApplicationIdSchema,
  applicantId: UserIdSchema,
  status: ApplicationStatusSchema,
  businessLicenseKey: UploadKeySchema,
  taxId: z.string(),
  nationalIdNumber: z.string(),
  nationalIdKey: UploadKeySchema,
  bankName: z.string(),
  bankAccountNumber: z.string(),
  accountHolder: z.string(),
  bankVerified: z.boolean(),
  reviewedAt: IsoDateTimeSchema.nullable(),
  rejectReason: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type VendorApplication = z.infer<typeof VendorApplicationSchema>;

/** Body of `POST /v1/platform/vendor-applications/:id/reject`. */
export const VendorRejectSchema = z.object({
  reason: requiredText(500),
});
export type VendorReject = z.infer<typeof VendorRejectSchema>;

/** `GET /v1/vendor-applications/me`: the applicant's own applications, newest first (`latest` = `history[0]`). */
export const VendorApplicationMeSchema = z.object({
  latest: VendorApplicationSchema.nullable(),
  history: z.array(VendorApplicationSchema),
});
export type VendorApplicationMe = z.infer<typeof VendorApplicationMeSchema>;

/** Query of `GET /v1/platform/vendor-applications`. */
export const VendorApplicationListQuerySchema = PageQuerySchema.extend({
  status: ApplicationStatusSchema.optional(),
});
export type VendorApplicationListQuery = z.infer<typeof VendorApplicationListQuerySchema>;

/**
 * Staff list row. KYC numbers are masked (all but the last 4 characters replaced by `*`); the
 * documents and full numbers are only in the detail view.
 */
export const VendorApplicationListItemSchema = z.object({
  id: VendorApplicationIdSchema,
  applicantId: UserIdSchema,
  applicantName: z.string(),
  status: ApplicationStatusSchema,
  taxIdMasked: z.string(),
  nationalIdNumberMasked: z.string(),
  bankName: z.string(),
  bankAccountNumberMasked: z.string(),
  accountHolder: z.string(),
  reviewedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type VendorApplicationListItem = z.infer<typeof VendorApplicationListItemSchema>;
export const VendorApplicationListPageSchema = PageSchema(VendorApplicationListItemSchema);
export type VendorApplicationListPage = z.infer<typeof VendorApplicationListPageSchema>;

/**
 * Staff detail (`GET /v1/platform/vendor-applications/:id`): the full application plus
 * short-lived presigned GET URLs for the KYC documents (never persist or share them).
 */
export const VendorApplicationDetailSchema = VendorApplicationSchema.extend({
  applicantName: z.string(),
  reviewedById: UserIdSchema.nullable(),
  businessLicenseUrl: HttpUrlSchema,
  nationalIdUrl: HttpUrlSchema,
});
export type VendorApplicationDetail = z.infer<typeof VendorApplicationDetailSchema>;

/** Body of `POST /v1/platform/vendor-applications/:id/approve`. */
export const VendorApproveSchema = z.object({
  slug: SlugSchema.min(1),
  displayName: requiredText(120),
});
export type VendorApprove = z.infer<typeof VendorApproveSchema>;

/** Result of approve / reject: the masked row after review; `vendorId` only when approved. */
export const VendorApplicationReviewResultSchema = VendorApplicationListItemSchema.extend({
  vendorId: VendorIdSchema.nullable(),
});
export type VendorApplicationReviewResult = z.infer<typeof VendorApplicationReviewResultSchema>;
