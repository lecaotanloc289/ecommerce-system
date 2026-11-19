import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { type Profile, Strategy } from 'passport-google-oauth20';
import { z } from 'zod';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { OAuthProfile } from '../auth.schemas';
import { toOAuthProfile } from './oauth-profile';

/** Google OpenID userinfo (`_json`). `email_verified` is sometimes serialized as a string. */
const GoogleUserInfoSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  picture: z.string().optional(),
});

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(@Inject(ENV) env: Env) {
    super({
      clientID: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      callbackURL: env.GOOGLE_OAUTH_CALLBACK_URL,
      scope: ['openid', 'email', 'profile'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
    const info = GoogleUserInfoSchema.parse(profile._json);
    return toOAuthProfile({
      provider: 'GOOGLE',
      providerUserId: info.sub,
      email: info.email,
      emailVerified: info.email_verified === true || info.email_verified === 'true',
      name: info.name,
      avatarUrl: info.picture,
    });
  }
}
