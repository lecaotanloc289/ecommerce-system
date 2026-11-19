import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { DomainError, Role, VendorStatus } from '@repo/core';
import { ulid } from 'ulid';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccessTokenClaimsSchema,
  type AccessTokenClaims,
  type AccessTokenClaimsInput,
  RefreshTokenClaimsSchema,
  type RefreshTokenClaims,
  type RefreshTokenClaimsInput,
  type TokenResponse,
  TokenResponseSchema,
} from './auth.schemas';
import { RefreshTokenStore } from './refresh-token.store';

const ALGORITHM = 'HS256';

export interface RoleRow {
  role: Role;
  vendorId: string | null;
  vendor: { status: VendorStatus } | null;
}

const VENDOR_ROLES: ReadonlySet<Role> = new Set([Role.VENDOR_OWNER, Role.VENDOR_STAFF]);

/**
 * Access-token claims from UserRole rows. Vendor roles count only while their vendor is
 * ACTIVE (a PENDING/SUSPENDED vendor grants nothing); `vendorId` is the oldest such role's
 * vendor (rows must be ordered by createdAt asc).
 */
export function buildClaims(userId: string, rows: readonly RoleRow[]): AccessTokenClaimsInput {
  const roles = new Set<Role>();
  let vendorId: string | undefined;
  for (const row of rows) {
    if (VENDOR_ROLES.has(row.role)) {
      if (row.vendorId === null || row.vendor?.status !== VendorStatus.ACTIVE) continue;
      vendorId ??= row.vendorId;
    }
    roles.add(row.role);
  }
  return { sub: userId, roles: [...roles], ...(vendorId !== undefined && { vendorId }) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RotatedSession {
  /** null on a grace-window retry: keep the cookie the concurrent winner already set. */
  refreshToken: string | null;
  access: TokenResponse;
}

/**
 * Access JWT (15m, body → client memory) + refresh JWT (30d, HttpOnly cookie) rotated on
 * every refresh with family-based reuse detection (state in RefreshTokenStore / Redis).
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly store: RefreshTokenStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Signs an access token from the user's current roles; null if the user no longer exists. */
  async issueAccessToken(userId: string): Promise<TokenResponse | null> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        roles: {
          select: { role: true, vendorId: true, vendor: { select: { status: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) return null;

    const claims = AccessTokenClaimsSchema.parse(buildClaims(user.id, user.roles));
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
      algorithm: ALGORITHM,
    });
    return TokenResponseSchema.parse({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
  }

  /** Verifies an access token (signature + expiry) and returns its claims. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, this.env.JWT_ACCESS_SECRET);
    const claims = AccessTokenClaimsSchema.safeParse(payload);
    if (!claims.success) throw new DomainError('auth.error.token-invalid');
    return claims.data;
  }

  /** Starts a new token family (one per login) and returns its first refresh token. */
  async startSession(userId: string): Promise<string> {
    const familyId = ulid();
    const refreshToken = await this.signRefreshToken({ sub: userId, fid: familyId, jti: ulid() });
    await this.store.createFamily(
      familyId,
      userId,
      hashToken(refreshToken),
      this.env.JWT_REFRESH_TTL,
    );
    return refreshToken;
  }

  /**
   * Exchanges a refresh token for a new refresh + access token. Presenting a token that was
   * already rotated revokes the whole family (stolen-token replay), as does a deleted user —
   * except a retry of the just-rotated token within REFRESH_REUSE_GRACE_MS, which gets an access
   * token but no new refresh token (`refreshToken: null`; the winner's cookie stays current).
   */
  async rotate(presented: string): Promise<RotatedSession> {
    const claims = await this.verifyRefreshToken(presented);

    // Everything that can fail transiently (DB) happens BEFORE the Redis swap: once the swap
    // commits, the client must receive the new cookie or its next retry would look like reuse.
    const access = await this.issueAccessToken(claims.sub);
    if (!access) {
      await this.store.revokeFamily(claims.fid);
      throw new DomainError('auth.error.refresh-revoked');
    }
    const next = await this.signRefreshToken({ sub: claims.sub, fid: claims.fid, jti: ulid() });

    const result = await this.store.rotate(
      claims.fid,
      hashToken(presented),
      hashToken(next),
      this.env.JWT_REFRESH_TTL,
    );
    if (result === 'rotated') return { refreshToken: next, access };
    if (result === 'grace') {
      // Normally a benign concurrent refresh; logged so a replay of a stolen just-rotated token
      // inside the window (which does not revoke the family) still leaves a trace.
      this.logger.log(
        { userId: claims.sub, familyId: claims.fid },
        'refresh token grace-window retry',
      );
      return { refreshToken: null, access };
    }
    if (result === 'reused') {
      this.logger.warn(
        { userId: claims.sub, familyId: claims.fid },
        'refresh token reuse detected',
      );
    }
    throw new DomainError('auth.error.refresh-revoked');
  }

  /** Revokes the presented token's family. Invalid/expired tokens are ignored (nothing to revoke). */
  async revoke(presented: string): Promise<void> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.verifyRefreshToken(presented);
    } catch {
      return;
    }
    await this.store.revokeFamily(claims.fid);
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    const payload = await this.verify(token, this.env.JWT_REFRESH_SECRET);
    const claims = RefreshTokenClaimsSchema.safeParse(payload);
    if (!claims.success) throw new DomainError('auth.error.token-invalid');
    return claims.data;
  }

  private signRefreshToken(claims: RefreshTokenClaimsInput): Promise<string> {
    return this.jwt.signAsync(RefreshTokenClaimsSchema.parse(claims), {
      secret: this.env.JWT_REFRESH_SECRET,
      expiresIn: this.env.JWT_REFRESH_TTL,
      algorithm: ALGORITHM,
    });
  }

  private async verify(token: string, secret: string): Promise<unknown> {
    try {
      return await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret,
        algorithms: [ALGORITHM],
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) throw new DomainError('auth.error.token-expired');
      throw new DomainError('auth.error.token-invalid');
    }
  }
}
