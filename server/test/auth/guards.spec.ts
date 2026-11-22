import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DomainError } from '@repo/core';
import { TokenService } from '../../src/auth/token.service';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { OAuthCallbackGuard, OAuthStartGuard } from '../../src/auth/guards/oauth.guards';
import { ALL_ROLES, Roles } from '../../src/auth/decorators/roles.decorator';
import {
  currentUserFactory,
  oauthProfileFactory,
} from '../../src/auth/decorators/current-user.decorator';
import { OAUTH_STATE_COOKIE } from '../../src/auth/auth.http';
import { AccessTokenClaimsSchema, type AccessTokenClaimsInput } from '../../src/auth/auth.schemas';
import { fakeReply, fakeRequest, httpContext } from '../helpers';

const USER_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const VENDOR_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0VND';

function verifierReturning(
  result: AccessTokenClaimsInput | Error,
): Pick<TokenService, 'verifyAccessToken'> {
  return {
    verifyAccessToken: jest.fn(() =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(AccessTokenClaimsSchema.parse(result)),
    ),
  };
}

describe('JwtAuthGuard', () => {
  const makeGuard = async (verifier: Pick<TokenService, 'verifyAccessToken'>) => {
    const moduleRef = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: TokenService, useValue: verifier }],
    }).compile();
    return moduleRef.get(JwtAuthGuard);
  };

  it('rejects a request without a Bearer token', async () => {
    const guard = await makeGuard(verifierReturning({ sub: USER_ID, roles: [] }));
    await expect(guard.canActivate(httpContext(fakeRequest()))).rejects.toMatchObject({
      code: 'common.error.unauthorized',
    });
    await expect(
      guard.canActivate(httpContext(fakeRequest({ headers: { authorization: 'Basic abc' } }))),
    ).rejects.toMatchObject({ code: 'common.error.unauthorized' });
  });

  it('propagates token verification errors', async () => {
    const guard = await makeGuard(verifierReturning(new DomainError('auth.error.token-expired')));
    const request = fakeRequest({ headers: { authorization: 'Bearer abc' } });
    await expect(guard.canActivate(httpContext(request))).rejects.toMatchObject({
      code: 'auth.error.token-expired',
    });
    expect(request.user).toBeUndefined();
  });

  it('sets request.user from verified claims', async () => {
    const verifier = verifierReturning({
      sub: USER_ID,
      roles: ['VENDOR_OWNER'],
      vendorId: VENDOR_ID,
    });
    const request = fakeRequest({ headers: { authorization: 'Bearer good.token' } });

    const guard = await makeGuard(verifier);
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('good.token');
    expect(request.user).toEqual({ id: USER_ID, roles: ['VENDOR_OWNER'], vendorId: VENDOR_ID });
  });
});

describe('RolesGuard + @Roles', () => {
  @Roles('PLATFORM_ADMIN')
  class AdminController {
    anyAdmin() {}
    @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
    vendorOnly() {}
  }
  class UndeclaredController {
    forgotRoles() {}
  }
  class OpenController {
    @Roles(...ALL_ROLES)
    open() {}
  }

  const guard = new RolesGuard(new Reflector());
  const ctx = (user: unknown, cls: new () => object, handler: () => void) =>
    httpContext(fakeRequest({ user }), fakeReply(), { cls, handler });

  it('fails closed: forbids a guarded route that declares no @Roles', () => {
    expect(() =>
      guard.canActivate(
        ctx(
          { id: 'u', roles: ['PLATFORM_ADMIN'] },
          UndeclaredController,
          UndeclaredController.prototype.forgotRoles,
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'common.error.forbidden' }));
  });

  it('@Roles(...ALL_ROLES) admits any authenticated user', () => {
    expect(
      guard.canActivate(
        ctx({ id: 'u', roles: ['CUSTOMER'] }, OpenController, OpenController.prototype.open),
      ),
    ).toBe(true);
  });

  it('allows a user holding one of the required roles (handler overrides class)', () => {
    const user = { id: 'u', roles: ['CUSTOMER', 'VENDOR_STAFF'] };
    expect(
      guard.canActivate(ctx(user, AdminController, AdminController.prototype.vendorOnly)),
    ).toBe(true);
  });

  it('falls back to class-level @Roles', () => {
    expect(
      guard.canActivate(
        ctx(
          { id: 'u', roles: ['PLATFORM_ADMIN'] },
          AdminController,
          AdminController.prototype.anyAdmin,
        ),
      ),
    ).toBe(true);
  });

  it('forbids a user without the required role', () => {
    expect(() =>
      guard.canActivate(
        ctx({ id: 'u', roles: ['CUSTOMER'] }, AdminController, AdminController.prototype.anyAdmin),
      ),
    ).toThrow(expect.objectContaining({ code: 'common.error.forbidden' }));
  });

  it('rejects when JwtAuthGuard did not run', () => {
    expect(() =>
      guard.canActivate(ctx(undefined, AdminController, AdminController.prototype.anyAdmin)),
    ).toThrow(expect.objectContaining({ code: 'common.error.unauthorized' }));
  });
});

describe('@CurrentUser / @CurrentOAuthProfile factories', () => {
  it('returns request.user', () => {
    const user = { id: 'u', roles: ['CUSTOMER'] };
    expect(currentUserFactory(undefined, httpContext(fakeRequest({ user })))).toBe(user);
  });

  it('throws unauthorized when there is no user', () => {
    expect(() => currentUserFactory(undefined, httpContext(fakeRequest()))).toThrow(
      expect.objectContaining({ code: 'common.error.unauthorized' }),
    );
  });

  it('returns request.oauthProfile or throws oauth-failed', () => {
    const oauthProfile = { provider: 'GOOGLE' };
    expect(oauthProfileFactory(undefined, httpContext(fakeRequest({ oauthProfile })))).toBe(
      oauthProfile,
    );
    expect(() => oauthProfileFactory(undefined, httpContext(fakeRequest()))).toThrow(
      expect.objectContaining({ code: 'auth.error.oauth-failed' }),
    );
  });
});

describe('OAuth state (login-CSRF) guards', () => {
  it('start guard binds a random state + app to an HttpOnly cookie and passes it to Passport', () => {
    const guard = new (OAuthStartGuard('google'))();
    const reply = fakeReply();
    const options = guard.getAuthenticateOptions(
      httpContext(fakeRequest({ query: { app: 'admin' } }), reply),
    );

    expect(options).toEqual({ session: false, state: expect.stringMatching(/^[\w-]{43}$/) });
    expect(reply.setCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      `${options?.state}.admin`,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/v1/auth' }),
    );
  });

  it('start guard falls back to app=web for an unknown app', () => {
    const guard = new (OAuthStartGuard('facebook'))();
    const reply = fakeReply();
    const options = guard.getAuthenticateOptions(
      httpContext(fakeRequest({ query: { app: 'evil' } }), reply),
    );
    expect(reply.setCookie.mock.calls[0][1]).toBe(`${options?.state}.web`);
  });

  it.each([
    ['no state cookie', {}, { state: 'abc' }],
    ['no state param', { [OAUTH_STATE_COOKIE]: 'abc.web' }, {}],
    ['mismatched state', { [OAUTH_STATE_COOKIE]: 'abc.web' }, { state: 'abd' }],
  ])('callback guard rejects %s before contacting the provider', (_case, cookies, query) => {
    const guard = new (OAuthCallbackGuard('google'))();
    const reply = fakeReply();
    expect(() => guard.canActivate(httpContext(fakeRequest({ cookies, query }), reply))).toThrow(
      expect.objectContaining({ code: 'auth.error.oauth-failed' }),
    );
    expect(reply.clearCookie).toHaveBeenCalledWith(OAUTH_STATE_COOKIE, expect.anything());
  });
});
