import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DomainError } from '@repo/core';
import { ENV } from '../../src/config/config.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RefreshTokenStore } from '../../src/auth/refresh-token.store';
import {
  buildClaims,
  hashToken,
  type RotatedSession,
  TokenService,
} from '../../src/auth/token.service';
import { InMemoryRefreshTokenStore, testEnv } from '../helpers';

const USER_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const VENDOR_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0VND';

/** The new refresh token of a real rotation (not a grace-window retry). */
function rotatedToken(session: RotatedSession): string {
  if (session.refreshToken === null) throw new Error('expected a rotation, got a grace retry');
  return session.refreshToken;
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('buildClaims', () => {
  it('collects distinct roles and the ACTIVE vendor id', () => {
    expect(
      buildClaims(USER_ID, [
        { role: 'CUSTOMER', vendorId: null, vendor: null },
        { role: 'VENDOR_OWNER', vendorId: VENDOR_ID, vendor: { status: 'ACTIVE' } },
        { role: 'CUSTOMER', vendorId: null, vendor: null },
      ]),
    ).toEqual({ sub: USER_ID, roles: ['CUSTOMER', 'VENDOR_OWNER'], vendorId: VENDOR_ID });
  });

  it('ignores vendor roles of PENDING/SUSPENDED vendors', () => {
    expect(
      buildClaims(USER_ID, [
        { role: 'CUSTOMER', vendorId: null, vendor: null },
        { role: 'VENDOR_OWNER', vendorId: VENDOR_ID, vendor: { status: 'SUSPENDED' } },
        { role: 'VENDOR_STAFF', vendorId: 'other', vendor: { status: 'PENDING' } },
      ]),
    ).toEqual({ sub: USER_ID, roles: ['CUSTOMER'] });
  });

  it('keeps the oldest active vendor when several exist', () => {
    const claims = buildClaims(USER_ID, [
      { role: 'VENDOR_STAFF', vendorId: 'first', vendor: { status: 'ACTIVE' } },
      { role: 'VENDOR_OWNER', vendorId: 'second', vendor: { status: 'ACTIVE' } },
    ]);
    expect(claims.vendorId).toBe('first');
  });
});

describe('TokenService', () => {
  const env = testEnv();
  let service: TokenService;
  let store: InMemoryRefreshTokenStore;
  let findUnique: jest.Mock;
  const jwt = new JwtService();

  beforeEach(async () => {
    store = new InMemoryRefreshTokenStore();
    findUnique = jest.fn().mockResolvedValue({
      id: USER_ID,
      roles: [{ role: 'CUSTOMER', vendorId: null, vendor: null }],
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwt },
        { provide: RefreshTokenStore, useValue: store },
        { provide: PrismaService, useValue: { client: { user: { findUnique } } } },
        { provide: ENV, useValue: env },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  describe('access tokens', () => {
    it('issues a 15m Bearer token whose claims come from UserRole rows', async () => {
      const issued = await service.issueAccessToken(USER_ID);
      expect(issued).toMatchObject({ tokenType: 'Bearer', expiresIn: 15 * 60 });
      const claims = await service.verifyAccessToken(issued?.accessToken ?? '');
      expect(claims).toEqual({ sub: USER_ID, roles: ['CUSTOMER'] });
    });

    it('returns null for a user that no longer exists', async () => {
      findUnique.mockResolvedValueOnce(null);
      await expect(service.issueAccessToken(USER_ID)).resolves.toBeNull();
    });

    it('rejects a token signed with another secret', async () => {
      const forged = await jwt.signAsync(
        { sub: USER_ID, roles: ['PLATFORM_ADMIN'] },
        { secret: 'some-other-secret-0123456789abcdefgh' },
      );
      await expectDomainError(service.verifyAccessToken(forged), 'auth.error.token-invalid');
    });

    it('rejects a refresh token used as an access token', async () => {
      const refresh = await service.startSession(USER_ID);
      await expectDomainError(service.verifyAccessToken(refresh), 'auth.error.token-invalid');
    });

    it('reports expiry distinctly', async () => {
      const expired = await jwt.signAsync(
        { sub: USER_ID, roles: ['CUSTOMER'], exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: env.JWT_ACCESS_SECRET },
      );
      await expectDomainError(service.verifyAccessToken(expired), 'auth.error.token-expired');
    });
  });

  describe('refresh rotation', () => {
    it('starts a family storing only the token hash', async () => {
      const token = await service.startSession(USER_ID);
      const [family] = [...store.families.values()];
      expect(store.families.size).toBe(1);
      expect(family).toEqual({ userId: USER_ID, current: hashToken(token), ttl: 30 * 86_400 });
      expect(JSON.stringify(family)).not.toContain(token);
    });

    it('rotates: returns a new refresh token + access token, and the old one stops working', async () => {
      const first = await service.startSession(USER_ID);
      const rotated = await service.rotate(first);

      const second = rotatedToken(rotated);
      expect(second).not.toBe(first);
      expect(rotated.access.tokenType).toBe('Bearer');
      const [family] = [...store.families.values()];
      expect(family?.current).toBe(hashToken(second));

      const again = await service.rotate(second);
      expect(rotatedToken(again)).not.toBe(second);
    });

    it('a concurrent retry of the just-rotated token (grace window) gets an access token only', async () => {
      const first = await service.startSession(USER_ID);
      const winner = rotatedToken(await service.rotate(first));

      const retry = await service.rotate(first);
      expect(retry.refreshToken).toBeNull();
      expect(retry.access.tokenType).toBe('Bearer');
      // Family intact; the winner's token is still the current one.
      expect(store.families.size).toBe(1);
      await expect(service.rotate(winner)).resolves.toHaveProperty('refreshToken');
    });

    it('a DB failure before the swap leaves the presented token usable (no false reuse)', async () => {
      const first = await service.startSession(USER_ID);
      findUnique.mockRejectedValueOnce(new Error('db blip'));
      await expect(service.rotate(first)).rejects.toThrow('db blip');

      // Client retries with the same cookie → a normal rotation, not reuse.
      const retried = await service.rotate(first);
      expect(rotatedToken(retried)).not.toBe(first);
      expect(store.families.size).toBe(1);
    });

    it('detects reuse of a rotated token and revokes the whole family', async () => {
      const first = await service.startSession(USER_ID);
      const second = rotatedToken(await service.rotate(first));
      store.skipGraceWindow();

      // Attacker replays the stolen, already-rotated token after the grace window.
      await expectDomainError(service.rotate(first), 'auth.error.refresh-revoked');
      expect(store.families.size).toBe(0);

      // The legitimate (latest) token is dead too.
      await expectDomainError(service.rotate(second), 'auth.error.refresh-revoked');
    });

    it('a token two rotations old is reuse even inside the grace window', async () => {
      const first = await service.startSession(USER_ID);
      const second = rotatedToken(await service.rotate(first));
      await service.rotate(second);

      await expectDomainError(service.rotate(first), 'auth.error.refresh-revoked');
      expect(store.families.size).toBe(0);
    });

    it('rejects tampered and expired refresh tokens without touching the store', async () => {
      await service.startSession(USER_ID);
      await expectDomainError(service.rotate('not-a-jwt'), 'auth.error.token-invalid');
      const expired = await jwt.signAsync(
        { sub: USER_ID, fid: 'f', jti: 'j', exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: env.JWT_REFRESH_SECRET },
      );
      await expectDomainError(service.rotate(expired), 'auth.error.token-expired');
      expect(store.families.size).toBe(1);
    });

    it('revokes the family when the user no longer exists', async () => {
      const token = await service.startSession(USER_ID);
      findUnique.mockResolvedValueOnce(null);
      await expectDomainError(service.rotate(token), 'auth.error.refresh-revoked');
      expect(store.families.size).toBe(0);
    });
  });

  describe('logout revoke', () => {
    it('revokes the family so the token can no longer be refreshed', async () => {
      const token = await service.startSession(USER_ID);
      await service.revoke(token);
      expect(store.families.size).toBe(0);
      await expectDomainError(service.rotate(token), 'auth.error.refresh-revoked');
    });

    it('only revokes the presented session, not other logins', async () => {
      const laptop = await service.startSession(USER_ID);
      const phone = await service.startSession(USER_ID);
      await service.revoke(laptop);
      await expect(service.rotate(phone)).resolves.toHaveProperty('refreshToken');
    });

    it('ignores an invalid token (idempotent logout)', async () => {
      await service.startSession(USER_ID);
      await expect(service.revoke('garbage')).resolves.toBeUndefined();
      expect(store.families.size).toBe(1);
    });
  });
});
