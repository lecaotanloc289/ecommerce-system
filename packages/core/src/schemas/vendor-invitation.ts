import { z } from 'zod';
import { VendorIdSchema, VendorInvitationIdSchema } from '../ids';
import { IsoDateTimeSchema } from './datetime';

/** Body of `POST /v1/vendor/invitations`. Emails are stored and matched lowercase. */
export const VendorInvitationCreateSchema = z.object({
  email: z.email().max(254).toLowerCase(),
});
export type VendorInvitationCreate = z.infer<typeof VendorInvitationCreateSchema>;

/** Invitation as listed to the vendor owner. The raw token is only ever emailed, never returned. */
export const VendorInvitationSchema = z.object({
  id: VendorInvitationIdSchema,
  vendorId: VendorIdSchema,
  email: z.string(),
  expiresAt: IsoDateTimeSchema,
  acceptedAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type VendorInvitation = z.infer<typeof VendorInvitationSchema>;

/** Body of `POST /v1/vendor-invitations/accept` (signed-in user with a verified matching email). */
export const VendorInvitationAcceptSchema = z.object({
  token: z.string().min(16).max(256),
});
export type VendorInvitationAccept = z.infer<typeof VendorInvitationAcceptSchema>;
