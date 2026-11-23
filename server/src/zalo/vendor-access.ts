import { DomainError } from '@repo/core';
import type { AuthUser } from '../auth/auth.schemas';
import type { PrismaService } from '../prisma/prisma.service';

/** The caller's vendor, from the JWT only (Golden Rule #6). No vendor claim → 403. */
export function requireVendorId(user: AuthUser): string {
  if (user.vendorId === undefined) throw new DomainError('common.error.forbidden');
  return user.vendorId;
}

/**
 * Re-checks the vendor in the DB before a write: the access token's `vendorId` stays valid up to
 * 15 min after a suspension. SUSPENDED → 403 `vendor.error.suspended`; any other non-ACTIVE → 403
 * `vendor.error.not-active`.
 */
export async function assertVendorActive(db: PrismaService, vendorId: string): Promise<void> {
  const vendor = await db.client.vendor.findUnique({
    where: { id: vendorId },
    select: { status: true },
  });
  if (vendor?.status === 'ACTIVE') return;
  throw new DomainError(
    vendor?.status === 'SUSPENDED' ? 'vendor.error.suspended' : 'vendor.error.not-active',
  );
}

/**
 * Owner-only writes: ACTIVE vendor AND a `VENDOR_OWNER` role row for this very vendor. JWT roles are
 * not per vendor, so a staff member of A who owns shop B must not act as owner of A.
 */
export async function assertVendorOwner(
  db: PrismaService,
  vendorId: string,
  userId: string,
): Promise<void> {
  await assertVendorActive(db, vendorId);
  const role = await db.client.userRole.findFirst({
    where: { userId, vendorId, role: 'VENDOR_OWNER' },
    select: { id: true },
  });
  if (!role) throw new DomainError('common.error.forbidden');
}
