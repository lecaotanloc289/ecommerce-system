import type { AuthUser, OAuthProfile } from '../auth/auth.schemas';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by JwtAuthGuard after verifying the access token. */
    user?: AuthUser;
    /** Set by the OAuth callback guards (Passport `property: 'oauthProfile'`). */
    oauthProfile?: OAuthProfile;
    /**
     * Exact request body bytes — captured (preParsing hook) only on routes declaring
     * `@RouteConfig({ rawBody: true })` (webhooks that verify signatures over the raw body).
     */
    rawBody?: Buffer;
  }

  interface FastifyContextConfig {
    /** Keep the raw JSON body on `request.rawBody` for this route (see common/raw-body.ts). */
    rawBody?: boolean;
  }
}
