import { z } from 'zod';
import { ApplicationStatusSchema } from '../enums';
import { UserIdSchema, VendorApplicationIdSchema, VendorIdSchema } from '../ids';
import { HttpUrlSchema, SlugSchema } from './common';
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

/** Body of `POST /v1/vendor-applications/:id/reject`. */
export const VendorRejectSchema = z.object({
  reason: requiredText(500),
});
export type VendorReject = z.infer<typeof VendorRejectSchema>;
