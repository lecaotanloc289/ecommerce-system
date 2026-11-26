import { DomainError } from '@repo/core';
import type { Prisma } from '@repo/db';

/**
 * Re-checks in the database that the actor still holds PLATFORM_ADMIN. The JWT can be up to 15
 * minutes stale, so a just-demoted admin must not be able to change settings or roles.
 */
export async function assertPlatformAdmin(
  tx: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  const held = await tx.userRole.findFirst({
    where: { userId: actorId, role: 'PLATFORM_ADMIN', vendorId: null },
    select: { id: true },
  });
  if (!held) throw new DomainError('common.error.forbidden', { reason: 'not-platform-admin' });
}
