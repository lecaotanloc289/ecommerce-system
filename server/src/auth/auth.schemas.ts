// TODO(core): move the response shapes below (TokenResponse, MeResponse) into
// @repo/core/schemas/auth so @repo/sdk, apps/web and apps/admin can parse them. Token-claim and
// OAuth-profile schemas are server-internal and stay here.
import { z } from 'zod';
import {
  LocaleSchema,
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

export const TokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

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
