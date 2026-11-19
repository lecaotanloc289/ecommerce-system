import { Test } from '@nestjs/testing';
import { DomainError, ULID_REGEX } from '@repo/core';
import type { OAuthProfile } from '../../src/auth/auth.schemas';
import { AuthService } from '../../src/auth/auth.service';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const EXISTING_USER = '01J9ZQ4V6N5X8Y7W3T2R1P0M9K';
const VENDOR_ID = '01J9ZQ4V6N5X8Y7W3T2R1P0VND';

function profile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    provider: 'GOOGLE',
    providerUserId: 'google-123',
    email: 'Alice@Example.com',
    emailVerified: true,
    name: 'Alice',
    avatarUrl: 'https://example.com/a.png',
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let tx: {
    oAuthIdentity: { findUnique: jest.Mock; create: jest.Mock };
    user: { findUnique: jest.Mock; create: jest.Mock };
  };
  let transaction: jest.Mock;
  let userFindUnique: jest.Mock;
  let startSession: jest.Mock;

  beforeEach(async () => {
    tx = {
      oAuthIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: { id: string } }) => ({
          id: data.id,
        })),
      },
    };
    transaction = jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx));
    userFindUnique = jest.fn();
    startSession = jest.fn().mockResolvedValue('refresh-token');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { client: { $transaction: transaction, user: { findUnique: userFindUnique } } },
        },
        { provide: TokenService, useValue: { startSession } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('resolveOAuthUser', () => {
    it('new user → creates User + OAuthIdentity + CUSTOMER role in one transaction', async () => {
      const userId = await service.resolveOAuthUser(profile());

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.create).toHaveBeenCalledTimes(1);
      const { data } = tx.user.create.mock.calls[0][0];
      expect(userId).toBe(data.id);
      expect(data.id).toMatch(ULID_REGEX);
      expect(data).toMatchObject({
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: 'https://example.com/a.png',
        oauthIdentities: {
          create: { provider: 'GOOGLE', providerUserId: 'google-123', emailVerified: true },
        },
        roles: { create: { role: 'CUSTOMER' } },
      });
      expect(data.oauthIdentities.create.id).toMatch(ULID_REGEX);
      expect(data.roles.create.id).toMatch(ULID_REGEX);
    });

    it('returning identity → logs in that user, creates nothing', async () => {
      tx.oAuthIdentity.findUnique.mockResolvedValue({ userId: EXISTING_USER });

      await expect(service.resolveOAuthUser(profile())).resolves.toBe(EXISTING_USER);
      expect(tx.oAuthIdentity.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider_providerUserId: { provider: 'GOOGLE', providerUserId: 'google-123' } },
        }),
      );
      expect(tx.user.create).not.toHaveBeenCalled();
      expect(tx.oAuthIdentity.create).not.toHaveBeenCalled();
    });

    it('verified email of an existing user → links a new identity to that user', async () => {
      tx.user.findUnique.mockResolvedValue({ id: EXISTING_USER });

      const userId = await service.resolveOAuthUser(profile());

      expect(userId).toBe(EXISTING_USER);
      expect(tx.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'alice@example.com' } }),
      );
      expect(tx.oAuthIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: EXISTING_USER,
          provider: 'GOOGLE',
          providerUserId: 'google-123',
          emailVerified: true,
        }),
      });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('UNVERIFIED email → never links; creates a separate user without storing the email', async () => {
      tx.user.findUnique.mockResolvedValue({ id: EXISTING_USER });

      const userId = await service.resolveOAuthUser(
        profile({ provider: 'FACEBOOK', providerUserId: 'fb-1', emailVerified: false }),
      );

      expect(userId).not.toBe(EXISTING_USER);
      expect(tx.user.findUnique).not.toHaveBeenCalled();
      expect(tx.oAuthIdentity.create).not.toHaveBeenCalled();
      const { data } = tx.user.create.mock.calls[0][0];
      expect(data.email).toBeNull();
      expect(data.oauthIdentities.create.emailVerified).toBe(false);
    });

    it('retries once on a unique violation from a concurrent first login', async () => {
      transaction
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        .mockImplementationOnce((run: (client: typeof tx) => Promise<unknown>) => {
          tx.oAuthIdentity.findUnique.mockResolvedValue({ userId: EXISTING_USER });
          return run(tx);
        });

      await expect(service.resolveOAuthUser(profile())).resolves.toBe(EXISTING_USER);
      expect(transaction).toHaveBeenCalledTimes(2);
    });

    it('does not swallow other errors', async () => {
      transaction.mockRejectedValueOnce(new Error('db down'));
      await expect(service.resolveOAuthUser(profile())).rejects.toThrow('db down');
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  it('loginWithOAuth starts a session for the resolved user', async () => {
    tx.oAuthIdentity.findUnique.mockResolvedValue({ userId: EXISTING_USER });
    await expect(service.loginWithOAuth(profile())).resolves.toBe('refresh-token');
    expect(startSession).toHaveBeenCalledWith(EXISTING_USER);
  });

  describe('getMe', () => {
    it('returns the profile with effective roles', async () => {
      userFindUnique.mockResolvedValue({
        id: EXISTING_USER,
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: null,
        primaryLocale: 'VI',
        roles: [
          { role: 'CUSTOMER', vendorId: null, vendor: null },
          { role: 'VENDOR_OWNER', vendorId: VENDOR_ID, vendor: { status: 'ACTIVE' } },
        ],
      });
      await expect(service.getMe(EXISTING_USER)).resolves.toEqual({
        id: EXISTING_USER,
        email: 'alice@example.com',
        name: 'Alice',
        avatarUrl: null,
        primaryLocale: 'VI',
        roles: ['CUSTOMER', 'VENDOR_OWNER'],
        vendorId: VENDOR_ID,
      });
    });

    it('rejects a deleted user', async () => {
      userFindUnique.mockResolvedValue(null);
      await expect(service.getMe(EXISTING_USER)).rejects.toBeInstanceOf(DomainError);
    });
  });
});
