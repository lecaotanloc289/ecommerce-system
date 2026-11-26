import type { Profile as FacebookProfile } from 'passport-facebook';
import type { Profile as GoogleProfile } from 'passport-google-oauth20';
import { FacebookStrategy } from '../../src/auth/strategies/facebook.strategy';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy';
import { testEnv } from '../helpers';

function googleProfile(json: GoogleProfile['_json']): GoogleProfile {
  return {
    provider: 'google',
    id: json.sub,
    displayName: json.name ?? '',
    profileUrl: '',
    _raw: JSON.stringify(json),
    _json: json,
  };
}

function facebookProfile(extra: Pick<FacebookProfile, 'emails' | 'photos'>): FacebookProfile {
  return {
    provider: 'facebook',
    id: 'fb-1',
    displayName: 'Bob',
    birthday: '',
    _raw: '',
    _json: {},
    ...extra,
  };
}

describe('GoogleStrategy.validate', () => {
  const strategy = new GoogleStrategy(testEnv());

  it('maps a verified OpenID profile', () => {
    const result = strategy.validate(
      '',
      '',
      googleProfile({
        iss: 'https://accounts.google.com',
        aud: 'google-id',
        sub: 'g-1',
        iat: 0,
        exp: 0,
        name: 'Alice',
        email: 'alice@example.com',
        email_verified: true,
        picture: 'https://example.com/a.png',
      }),
    );
    expect(result).toEqual({
      provider: 'GOOGLE',
      providerUserId: 'g-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
      avatarUrl: 'https://example.com/a.png',
    });
  });

  it('treats email_verified=false as unverified and survives missing fields', () => {
    const result = strategy.validate(
      '',
      '',
      googleProfile({
        iss: '',
        aud: '',
        sub: 'g-2',
        iat: 0,
        exp: 0,
        email: 'x@example.com',
        email_verified: false,
      }),
    );
    expect(result).toMatchObject({ emailVerified: false, name: 'x', avatarUrl: null });
  });
});

describe('FacebookStrategy.validate', () => {
  const strategy = new FacebookStrategy(testEnv());

  it('never marks a Facebook email as verified', () => {
    const result = strategy.validate(
      '',
      '',
      facebookProfile({
        emails: [{ value: 'bob@example.com' }],
        photos: [{ value: 'https://example.com/b.png' }],
      }),
    );
    expect(result).toEqual({
      provider: 'FACEBOOK',
      providerUserId: 'fb-1',
      email: 'bob@example.com',
      emailVerified: false,
      name: 'Bob',
      avatarUrl: 'https://example.com/b.png',
    });
  });

  it('drops a malformed email/avatar instead of failing the login', () => {
    const result = strategy.validate(
      '',
      '',
      facebookProfile({ emails: [{ value: 'not-an-email' }], photos: [{ value: 'nope' }] }),
    );
    expect(result).toMatchObject({ email: null, emailVerified: false, avatarUrl: null });
  });
});
