import { z } from 'zod';
import { RoleSchema } from '../enums';
import { UserIdSchema, VendorIdSchema, VendorInvitationIdSchema } from '../ids';
import { PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';

/** Body of `POST /v1/vendor/invitations`. Emails are stored and matched lowercase. */
export const VendorInvitationCreateSchema = z.object({
  email: z.email().max(254).toLowerCase(),
});
export type VendorInvitationCreate = z.infer<typeof VendorInvitationCreateSchema>;

/** Derived, never stored: ACCEPTED / REVOKED win over the expiry date. */
export const VendorInvitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);
export type VendorInvitationStatus = z.infer<typeof VendorInvitationStatusSchema>;

/** Invitation as listed to the vendor owner. The raw token is only ever emailed, never returned. */
export const VendorInvitationSchema = z.object({
  id: VendorInvitationIdSchema,
  vendorId: VendorIdSchema,
  email: z.string(),
  status: VendorInvitationStatusSchema,
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type VendorInvitation = z.infer<typeof VendorInvitationSchema>;

export const VendorInvitationPageSchema = PageSchema(VendorInvitationSchema);
export type VendorInvitationPage = z.infer<typeof VendorInvitationPageSchema>;

/** Body of `POST /v1/vendor-invitations/accept` (signed-in user with a verified matching email). */
export const VendorInvitationAcceptSchema = z.object({
  token: z.string().min(16).max(256),
});
export type VendorInvitationAccept = z.infer<typeof VendorInvitationAcceptSchema>;

/** Result of accepting. The new role shows in the next access token (call `/auth/refresh`). */
export const VendorInvitationAcceptResultSchema = z.object({ vendorId: VendorIdSchema });
export type VendorInvitationAcceptResult = z.infer<typeof VendorInvitationAcceptResultSchema>;

/** A user holding a role on the vendor (`GET /v1/vendor/staff`); `email` is null without a verified one. */
export const VendorStaffMemberSchema = z.object({
  userId: UserIdSchema,
  name: z.string(),
  email: z.string().nullable(),
  role: z.enum([RoleSchema.enum.VENDOR_OWNER, RoleSchema.enum.VENDOR_STAFF]),
  joinedAt: IsoDateTimeSchema,
});
export type VendorStaffMember = z.infer<typeof VendorStaffMemberSchema>;
