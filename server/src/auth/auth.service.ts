import { Injectable } from '@nestjs/common';
import { DomainError, Role } from '@repo/core';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { type MeResponse, MeResponseSchema, type OAuthProfile } from './auth.schemas';
import { buildClaims, TokenService } from './token.service';

/** Prisma unique-constraint violation (concurrent first login racing on the same identity/email). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /** OAuth callback: resolve (or create/link) the user and start a session → refresh token. */
  async loginWithOAuth(profile: OAuthProfile): Promise<string> {
    const userId = await this.resolveOAuthUser(profile);
    return this.tokens.startSession(userId);
  }

  /**
   * Resolves the local user for an OAuth login, in one transaction:
   *  1. known (provider, providerUserId) → that user (returning login)
   *  2. provider-VERIFIED email matching an existing User → link a new OAuthIdentity to it
   *  3. otherwise → create User + OAuthIdentity + UserRole CUSTOMER
   * Unverified emails are never linked and never stored on User.email, so nobody can
   * pre-claim an address and later absorb its real owner's verified login.
   */
  async resolveOAuthUser(profile: OAuthProfile): Promise<string> {
    try {
      return await this.resolveInTransaction(profile);
    } catch (error) {
      // A concurrent first login committed the same identity/email first — retry once,
      // which now takes the "returning" or "link" branch.
      if (!isUniqueViolation(error)) throw error;
      return this.resolveInTransaction(profile);
    }
  }

  async getMe(userId: string): Promise<MeResponse> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        primaryLocale: true,
        roles: {
          select: { role: true, vendorId: true, vendor: { select: { status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new DomainError('common.error.unauthorized');
    const claims = buildClaims(user.id, user.roles);
    return MeResponseSchema.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      primaryLocale: user.primaryLocale,
      roles: claims.roles,
      vendorId: claims.vendorId ?? null,
    });
  }

  private resolveInTransaction(profile: OAuthProfile): Promise<string> {
    const email = profile.email?.trim().toLowerCase() ?? null;
    const verifiedEmail = profile.emailVerified ? email : null;

    return this.prisma.client.$transaction(async (tx) => {
      const identity = await tx.oAuthIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
          },
        },
        select: { userId: true },
      });
      if (identity) return identity.userId;

      const identityData = {
        id: ulid(),
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        emailVerified: profile.emailVerified,
      };

      if (verifiedEmail) {
        const existing = await tx.user.findUnique({
          where: { email: verifiedEmail },
          select: { id: true },
        });
        if (existing) {
          await tx.oAuthIdentity.create({ data: { ...identityData, userId: existing.id } });
          return existing.id;
        }
      }

      const user = await tx.user.create({
        data: {
          id: ulid(),
          email: verifiedEmail,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          oauthIdentities: { create: identityData },
          roles: { create: { id: ulid(), role: Role.CUSTOMER } },
        },
        select: { id: true },
      });
      return user.id;
    });
  }
}
