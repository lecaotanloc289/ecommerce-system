import type { AuthUser, OAuthProfile } from '../auth/auth.schemas';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by JwtAuthGuard after verifying the access token. */
    user?: AuthUser;
    /** Set by the OAuth callback guards (Passport `property: 'oauthProfile'`). */
    oauthProfile?: OAuthProfile;
  }
}
