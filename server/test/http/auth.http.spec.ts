import cookie from '@fastify/cookie';
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import passport from 'passport';
import type { OAuthProfile } from '../../src/auth/auth.schemas';
import { AuthModule } from '../../src/auth/auth.module';
import { RefreshTokenStore } from '../../src/auth/refresh-token.store';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy';
import { DomainErrorFilter } from '../../src/common/domain-error.filter';
import { ENV } from '../../src/config/config.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InMemoryRefreshTokenStore, testEnv } from '../helpers';

/**
 * In-process HTTP test (Fastify inject, no network): real AuthModule, guards, cookies and
 * filters; Prisma mocked, Redis replaced by the in-memory store, and the provider's code
 * exchange stubbed at the Passport level.
 */
const env = testEnv();
const USER_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const googleProfile: OAuthProfile = {
  provider: 'GOOGLE',
  providerUserId: 'g-1',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
  avatarUrl: null,
};

const tx = {
  oAuthIdentity: { findUnique: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn(), create: jest.fn() },
};
const prisma = {
  client: {
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: USER_ID,
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: null,
        primaryLocale: 'EN',
        roles: [{ role: 'CUSTOMER', vendorId: null, vendor: null }],
      }),
    },
  },
};

@Global()
@Module({
  providers: [
    { provide: ENV, useValue: env },
    { provide: PrismaService, useValue: prisma },
  ],
  exports: [ENV, PrismaService],
})
class TestInfraModule {}

type SetCookie = { name: string; value: string; [attr: string]: unknown };
function cookieNamed(cookies: SetCookie[], name: string): SetCookie | undefined {
  return cookies.find((c) => c.name === name);
}

describe('Auth HTTP flow', () => {
  let app: NestFastifyApplication;
  let store: InMemoryRefreshTokenStore;

  beforeAll(async () => {
    store = new InMemoryRefreshTokenStore();
    const moduleRef = await Test.createTestingModule({
      imports: [TestInfraModule, AuthModule],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    })
      .overrideProvider(RefreshTokenStore)
      .useValue(store)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('v1');
    await app.register(cookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(() => app.close());

  // stubGoogleExchange() swaps the passport-global 'google' strategy; put the real one back.
  afterEach(() => passport.use('google', app.get(GoogleStrategy)));

  beforeEach(() => {
    store.families.clear();
    store.now = () => Date.now();
    tx.oAuthIdentity.findUnique.mockResolvedValue({ userId: USER_ID });
  });

  /** Replace the real Google strategy's code exchange with a fixed successful profile. */
  function stubGoogleExchange() {
    passport.use('google', {
      name: 'google',
      authenticate(this: passport.StrategyCreated<passport.Strategy>) {
        this.success(googleProfile);
      },
    });
  }

  async function startLogin(query = '') {
    const res = await app.inject({ method: 'GET', url: `/v1/auth/google${query}` });
    const state = cookieNamed(res.cookies, 'oauth_state');
    return { res, state };
  }

  async function login(): Promise<string> {
    const { state } = await startLogin();
    const value = state?.value ?? '';
    const res = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=c&state=${value.split('.')[0]}`,
      cookies: { oauth_state: value },
    });
    expect(res.statusCode).toBe(302);
    return cookieNamed(res.cookies, 'refresh_token')?.value ?? '';
  }

  it('GET /auth/google redirects to Google with a state bound to an HttpOnly cookie', async () => {
    const { res, state } = await startLogin('?app=admin');

    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('client_id')).toBe('google-id');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(state).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/v1/auth',
    });
    expect(state?.value).toBe(`${location.searchParams.get('state')}.admin`);
  });

  it('callback with a forged state redirects back with an error and sets no session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/google/callback?code=c&state=forged',
      cookies: { oauth_state: 'real.admin' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(
      'http://localhost:5173/auth/callback?error=auth.error.oauth-failed',
    );
    expect(cookieNamed(res.cookies, 'refresh_token')).toBeUndefined();
    expect(store.families.size).toBe(0);
  });

  it('full flow: callback → refresh (rotation) → /me → reuse detection', async () => {
    stubGoogleExchange();
    const { state } = await startLogin();
    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?code=c&state=${state?.value.split('.')[0]}`,
      cookies: { oauth_state: state?.value ?? '' },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/auth/callback');
    const first = cookieNamed(callback.cookies, 'refresh_token');
    expect(first).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/v1/auth',
      maxAge: 30 * 86_400,
    });

    // Rotate.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: first?.value ?? '' },
    });
    expect(refreshed.statusCode).toBe(200);
    const body = refreshed.json<{ accessToken: string; tokenType: string; expiresIn: number }>();
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const second = cookieNamed(refreshed.cookies, 'refresh_token');
    expect(second?.value).toBeTruthy();
    expect(second?.value).not.toBe(first?.value);

    // Access token works on /me.
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: USER_ID, roles: ['CUSTOMER'], vendorId: null });

    // A concurrent retry with the old cookie (grace window) gets an access token, no new cookie.
    const retry = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: first?.value ?? '' },
    });
    expect(retry.statusCode).toBe(200);
    expect(cookieNamed(retry.cookies, 'refresh_token')).toBeUndefined();

    // After the grace window, replaying the rotated token kills the family, incl. the latest token.
    store.skipGraceWindow();
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: first?.value ?? '' },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ errorCode: 'auth.error.refresh-revoked', params: {} });
    expect(cookieNamed(replay.cookies, 'refresh_token')?.value).toBe('');

    const latest = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: second?.value ?? '' },
    });
    expect(latest.statusCode).toBe(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    stubGoogleExchange();
    const token = await login();

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      cookies: { refresh_token: token },
    });
    expect(logout.statusCode).toBe(204);
    expect(cookieNamed(logout.cookies, 'refresh_token')?.value).toBe('');

    const after = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      cookies: { refresh_token: token },
    });
    expect(after.statusCode).toBe(401);
  });

  it('rejects refresh without a cookie and /me without a valid token', async () => {
    const refresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh' });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json()).toEqual({ errorCode: 'auth.error.token-invalid', params: {} });

    const noToken = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(noToken.json()).toEqual({ errorCode: 'common.error.unauthorized', params: {} });

    const forged = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: 'Bearer abc.def.ghi' },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toEqual({ errorCode: 'auth.error.token-invalid', params: {} });
  });
});
