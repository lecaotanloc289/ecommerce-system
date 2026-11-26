// Server-internal auth schemas (token claims, request user, OAuth profile). The HTTP response shapes
// (TokenResponse, MeResponse) live in @repo/core/schemas/me so @repo/sdk and the frontends share them.
import { z } from 'zod';
import {
  OAuthProviderSchema,
  RoleSchema,
  UlidSchema,
  UserIdSchema,
  VendorIdSchema,
} from '@repo/core';

/** Access JWT payload (Golden Rule #5). `vendorId` only for users with an ACTIVE vendor role. */
export const AccessTokenClaimsSchema = z.object({
  sub: UserIdSchema,
  roles: z.array(RoleSchema),
  vendorId: VendorIdSchema.optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;
/** Unbranded shape (plain-string ids) — what is built from DB rows before parsing. */
export type AccessTokenClaimsInput = z.input<typeof AccessTokenClaimsSchema>;

/** Refresh JWT payload: `fid` = token family (one per login session), `jti` = this token. */
export const RefreshTokenClaimsSchema = z.object({
  sub: UserIdSchema,
  fid: UlidSchema,
  jti: UlidSchema,
});
export type RefreshTokenClaims = z.infer<typeof RefreshTokenClaimsSchema>;
export type RefreshTokenClaimsInput = z.input<typeof RefreshTokenClaimsSchema>;

/** What guards attach to `request.user` and `@CurrentUser()` returns. */
export const AuthUserSchema = z.object({
  id: UserIdSchema,
  roles: z.array(RoleSchema),
  vendorId: VendorIdSchema.optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Provider profile normalized by the Passport strategies. */
export const OAuthProfileSchema = z.object({
  provider: OAuthProviderSchema,
  providerUserId: z.string().min(1),
  email: z.email().nullable(),
  /** True only when the provider asserts the email is verified. */
  emailVerified: z.boolean(),
  name: z.string(),
  avatarUrl: z.url().nullable(),
});
export type OAuthProfile = z.infer<typeof OAuthProfileSchema>;

/** Which frontend started the OAuth flow; decides the post-login redirect. */
export const AuthAppSchema = z.enum(['web', 'admin']);
export type AuthApp = z.infer<typeof AuthAppSchema>;
