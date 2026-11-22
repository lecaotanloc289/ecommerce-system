import { z } from 'zod';
import { LocaleSchema, RoleSchema } from '../enums';
import { UserIdSchema, VendorIdSchema } from '../ids';

/** Response of `POST /v1/auth/refresh`. The refresh token itself travels in an HttpOnly cookie. */
export const TokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

/** Response of `GET /v1/auth/me`: current user profile + effective roles. */
export const MeResponseSchema = z.object({
  id: UserIdSchema,
  email: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  primaryLocale: LocaleSchema,
  roles: z.array(RoleSchema),
  vendorId: VendorIdSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Body of `PATCH /v1/me`. Email, roles and avatar are never client-editable. */
export const ProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    primaryLocale: LocaleSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
