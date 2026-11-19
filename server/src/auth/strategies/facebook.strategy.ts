import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { type Profile, Strategy } from 'passport-facebook';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { OAuthProfile } from '../auth.schemas';
import { toOAuthProfile } from './oauth-profile';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(@Inject(ENV) env: Env) {
    super({
      clientID: env.FACEBOOK_OAUTH_CLIENT_ID,
      clientSecret: env.FACEBOOK_OAUTH_CLIENT_SECRET,
      callbackURL: env.FACEBOOK_OAUTH_CALLBACK_URL,
      scope: ['email', 'public_profile'],
      profileFields: ['id', 'displayName', 'emails', 'photos'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile): OAuthProfile {
    return toOAuthProfile({
      provider: 'FACEBOOK',
      providerUserId: profile.id,
      email: profile.emails?.[0]?.value,
      // The Graph API gives no verification guarantee for `email`, so a Facebook email is
      // never treated as verified: it is not linked to existing users nor stored on User.
      emailVerified: false,
      name: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
    });
  }
}
