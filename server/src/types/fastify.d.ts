import type { AuthUser, OAuthProfile } from '../auth/auth.schemas';
import type { RateLimitTier } from '../common/rate-limit';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by JwtAuthGuard after verifying the access token. */
    user?: AuthUser;
    /** Set by the OAuth callback guards (Passport `property: 'oauthProfile'`). */
    oauthProfile?: OAuthProfile;
  }

  interface FastifyContextConfig {
    /** Set by `@RateLimit(tier)`; read by the rate-limit `max` resolver. */
    rateLimitTier?: RateLimitTier;
  }
}
