import { Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type PlatformRole,
  type PlatformUser,
  type PlatformUserListQuery,
  type PlatformUserPage,
  PlatformUserPageSchema,
  PlatformUserSchema,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { assertPlatformAdmin } from './platform-admin-guard';

const WITH_ROLES = {
  include: { roles: { select: { role: true } } },
} satisfies Prisma.UserDefaultArgs;
type UserRow = Prisma.UserGetPayload<typeof WITH_ROLES>;

function toPlatformUser(row: UserRow): PlatformUser {
  return PlatformUserSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    roles: [...new Set(row.roles.map((r) => r.role))],
    createdAt: row.createdAt.toISOString(),
  });
}

/** Serialises every change to the set of platform admins (last-admin guard). */
const ADMIN_ROLES_LOCK = 'platform-admin-roles';

/**
 * Platform role management. Granted/revoked roles reach the user's JWT on their next refresh;
 * a revoked admin's current access token stays valid for up to 15 minutes (no denylist yet).
 */
@Injectable()
export class PlatformUsersService {
  private readonly logger = new Logger(PlatformUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformUserListQuery): Promise<PlatformUserPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.user.findMany({
      ...args,
      where: {
        ...(query.q && {
          OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { name: { contains: query.q, mode: 'insensitive' } },
          ],
        }),
        ...args.where,
      },
      ...WITH_ROLES,
    });
    const page = toPage(rows, query);
    return PlatformUserPageSchema.parse({
      items: page.items.map(toPlatformUser),
      nextCursor: page.nextCursor,
    });
  }

  /** Grants a platform role; already held is a no-op (the unique index does not cover NULL vendor ids). */
  async grant(actorId: string, userId: string, role: PlatformRole): Promise<PlatformUser> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx);
      await assertPlatformAdmin(tx, actorId);
      const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!exists) throw new DomainError('common.error.not-found', { id: userId });
      const held = await tx.userRole.findFirst({ where: { userId, role, vendorId: null } });
      if (!held) await tx.userRole.create({ data: { id: ulid(), userId, role, vendorId: null } });
      return tx.user.findUniqueOrThrow({ where: { id: userId }, ...WITH_ROLES });
    });
    this.logger.log({ actorId, userId, role }, 'platform role granted');
    return toPlatformUser(row);
  }

  /**
   * Revokes a platform role; not held is a no-op. An admin cannot remove their own
   * PLATFORM_ADMIN (403) and the last PLATFORM_ADMIN can never be removed (409).
   */
  async revoke(actorId: string, userId: string, role: PlatformRole): Promise<PlatformUser> {
    if (role === 'PLATFORM_ADMIN' && actorId === userId) {
      throw new DomainError('common.error.forbidden', { reason: 'self-demotion' });
    }
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.lock(tx);
      await assertPlatformAdmin(tx, actorId);
      const exists = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!exists) throw new DomainError('common.error.not-found', { id: userId });
      const held = await tx.userRole.findFirst({ where: { userId, role, vendorId: null } });
      if (held) {
        if (role === 'PLATFORM_ADMIN') {
          const others = await tx.userRole.count({
            where: { role: 'PLATFORM_ADMIN', userId: { not: userId } },
          });
          if (others === 0) {
            throw new DomainError('common.error.conflict', { reason: 'last-platform-admin' });
          }
        }
        await tx.userRole.deleteMany({ where: { userId, role, vendorId: null } });
      }
      return tx.user.findUniqueOrThrow({ where: { id: userId }, ...WITH_ROLES });
    });
    this.logger.log({ actorId, userId, role }, 'platform role revoked');
    return toPlatformUser(row);
  }

  private async lock(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_ROLES_LOCK}))`;
  }
}
