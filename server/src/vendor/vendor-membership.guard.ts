import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '@repo/core';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Re-checks in the DB that the caller still holds a vendor role on `req.user.vendorId`: a staff
 * member whose role was revoked would otherwise keep access until the 15m access JWT expires.
 * Runs after `JwtAuthGuard` + `RolesGuard`.
 */
@Injectable()
export class VendorMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<FastifyRequest>();
    if (!user?.vendorId) throw new DomainError('vendor.error.not-active');
    const count = await this.prisma.client.userRole.count({
      where: {
        userId: user.id,
        vendorId: user.vendorId,
        role: { in: ['VENDOR_OWNER', 'VENDOR_STAFF'] },
      },
    });
    if (count === 0) throw new DomainError('common.error.forbidden');
    return true;
  }
}
