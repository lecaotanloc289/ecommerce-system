import { Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type PlatformVendor,
  type PlatformVendorListQuery,
  type PlatformVendorPage,
  PlatformVendorPageSchema,
  PlatformVendorSchema,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const WITH_OWNER = {
  include: { owner: { select: { name: true, email: true } } },
} satisfies Prisma.VendorDefaultArgs;
type VendorRow = Prisma.VendorGetPayload<typeof WITH_OWNER>;

function toPlatformVendor(row: VendorRow): PlatformVendor {
  return PlatformVendorSchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    status: row.status,
    suspendedReason: row.suspendedReason,
    commissionBpsOverride: row.commissionBpsOverride,
    ownerId: row.ownerId,
    ownerName: row.owner.name,
    ownerEmail: row.owner.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Vendor moderation. Suspension is enforced where vendors act: catalog, cart and checkout only
 * accept ACTIVE vendors, and every vendor write re-reads `vendors.status` (`assertVendorActive`).
 * Access tokens issued before the suspension keep their vendor role for up to 15 minutes, but the
 * DB re-check stops writes at once.
 */
@Injectable()
export class PlatformVendorsService {
  private readonly logger = new Logger(PlatformVendorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformVendorListQuery): Promise<PlatformVendorPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.vendor.findMany({
      ...args,
      where: {
        ...(query.status && { status: query.status }),
        ...(query.q && {
          OR: [
            { displayName: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
            { owner: { email: { contains: query.q, mode: 'insensitive' } } },
          ],
        }),
        ...args.where,
      },
      ...WITH_OWNER,
    });
    const page = toPage(rows, query);
    return PlatformVendorPageSchema.parse({
      items: page.items.map(toPlatformVendor),
      nextCursor: page.nextCursor,
    });
  }

  /** ACTIVE → SUSPENDED (any other status → 409). Locks the vendor row. */
  async suspend(actorId: string, id: string, reason: string): Promise<PlatformVendor> {
    const row = await this.transition(id, 'ACTIVE', {
      status: 'SUSPENDED',
      suspendedReason: reason,
    });
    this.logger.log({ actorId, vendorId: id }, 'vendor suspended');
    return toPlatformVendor(row);
  }

  /** SUSPENDED → ACTIVE, clearing the reason (any other status → 409). */
  async reactivate(actorId: string, id: string): Promise<PlatformVendor> {
    const row = await this.transition(id, 'SUSPENDED', {
      status: 'ACTIVE',
      suspendedReason: null,
    });
    this.logger.log({ actorId, vendorId: id }, 'vendor reactivated');
    return toPlatformVendor(row);
  }

  private transition(
    id: string,
    from: 'ACTIVE' | 'SUSPENDED',
    data: Prisma.VendorUpdateInput,
  ): Promise<VendorRow> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM vendors WHERE id = ${id} FOR UPDATE`;
      const status = rows[0]?.status;
      if (status === undefined) throw new DomainError('vendor.error.not-found', { id });
      if (status !== from) throw new DomainError('common.error.conflict', { id, status });
      return tx.vendor.update({ where: { id }, data, ...WITH_OWNER });
    });
  }
}
