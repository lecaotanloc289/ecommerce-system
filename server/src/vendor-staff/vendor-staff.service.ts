import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DomainError,
  type PageQuery,
  VENDOR_INVITATION_AGGREGATE_TYPE,
  type VendorInvitation,
  type VendorInvitationAcceptResult,
  VendorInvitationAcceptResultSchema,
  type VendorInvitationPage,
  VendorInvitationCreatedEventSchema,
  VendorInvitationPageSchema,
  VendorInvitationSchema,
  type VendorInvitationStatus,
  type VendorStaffMember,
  VendorStaffMemberSchema,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { assertVendorActive, isUniqueViolation } from '../vendor/vendor-scope';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VENDOR_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF'] as const;

/** sha256 hex of the raw token — the only form stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type InvitationRow = Prisma.VendorInvitationGetPayload<Record<string, never>>;

export function invitationStatus(row: InvitationRow, now: Date): VendorInvitationStatus {
  if (row.acceptedAt) return 'ACCEPTED';
  if (row.revokedAt) return 'REVOKED';
  return row.expiresAt <= now ? 'EXPIRED' : 'PENDING';
}

function toInvitation(row: InvitationRow, now: Date): VendorInvitation {
  return VendorInvitationSchema.parse({
    id: row.id,
    vendorId: row.vendorId,
    email: row.email,
    status: invitationStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

interface LockedInvitation {
  id: string;
  vendor_id: string;
  email: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

/** Staff invitations and the staff list of one vendor (vendor always from `req.user`). */
@Injectable()
export class VendorStaffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One `$transaction`: vendor must be ACTIVE; refuse an email that already holds a role on this
   * vendor or has an open invitation (serialised per vendor + email with an advisory lock — there
   * is no unique index for "open"); store sha256(token) and write outbox
   * `vendor.invitation.created` carrying the raw token (the worker emails it, then scrubs it).
   */
  async invite(vendorId: string, invitedById: string, email: string): Promise<VendorInvitation> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await assertVendorActive(tx, vendorId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vendor-invitation:${vendorId}:${email}`}, 0))`;
        const member = await tx.userRole.count({
          where: { vendorId, role: { in: [...VENDOR_ROLES] }, user: { email } },
        });
        if (member > 0) throw new DomainError('common.error.conflict', { field: 'email' });
        const open = await tx.vendorInvitation.count({
          where: { vendorId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        });
        if (open > 0) throw new DomainError('common.error.conflict', { field: 'email' });
        const row = await tx.vendorInvitation.create({
          data: {
            id: ulid(),
            vendorId,
            email,
            tokenHash: hashToken(token),
            invitedById,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: ulid(),
            aggregateType: VENDOR_INVITATION_AGGREGATE_TYPE,
            aggregateId: row.id,
            eventType: 'vendor.invitation.created',
            payload: VendorInvitationCreatedEventSchema.parse({
              invitationId: row.id,
              vendorId,
              email,
              token,
            }),
          },
        });
        return toInvitation(row, now);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('common.error.conflict');
      throw error;
    }
  }

  async list(vendorId: string, query: PageQuery): Promise<VendorInvitationPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.vendorInvitation.findMany({
      ...args,
      where: { vendorId, ...args.where },
    });
    const now = new Date();
    const page = toPage(rows, query);
    return VendorInvitationPageSchema.parse({
      ...page,
      items: page.items.map((row) => toInvitation(row, now)),
    });
  }

  /** Revokes a PENDING/EXPIRED invitation (already revoked: no-op); accepted → 409. */
  revoke(vendorId: string, id: string): Promise<VendorInvitation> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM vendor_invitations WHERE id = ${id} AND vendor_id = ${vendorId} FOR UPDATE`;
      if (locked.length === 0) throw new DomainError('common.error.not-found', { id });
      const current = await tx.vendorInvitation.findUniqueOrThrow({ where: { id } });
      if (current.acceptedAt) throw new DomainError('common.error.conflict', { id });
      const row = current.revokedAt
        ? current
        : await tx.vendorInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
      return toInvitation(row, new Date());
    });
  }

  async listStaff(vendorId: string): Promise<VendorStaffMember[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { vendorId, role: { in: [...VENDOR_ROLES] } },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) =>
      VendorStaffMemberSchema.parse({
        userId: row.userId,
        name: row.user.name,
        email: row.user.email,
        role: row.role,
        joinedAt: row.createdAt.toISOString(),
      }),
    );
  }

  /** Drops the VENDOR_STAFF role on this vendor; the owner cannot be removed (403). */
  async removeStaff(vendorId: string, userId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const roles = await tx.userRole.findMany({
        where: { vendorId, userId, role: { in: [...VENDOR_ROLES] } },
        select: { id: true, role: true },
      });
      if (roles.some((r) => r.role === 'VENDOR_OWNER')) {
        throw new DomainError('common.error.forbidden');
      }
      if (roles.length === 0) throw new DomainError('common.error.not-found', { userId });
      await tx.userRole.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
    });
  }

  /**
   * Accept in one `$transaction`: lock the invitation by sha256(token) (`FOR UPDATE`), the user
   * row (so one user cannot join two vendors concurrently) and check in order: unknown / revoked /
   * accepted → 422 `invitation.error.invalid`; expired → 410; vendor ACTIVE; `User.email` (only
   * ever a verified one) must equal the invitation email, null never matches → 403
   * `invitation.error.email-mismatch`; the user must not hold a role on another vendor (the JWT
   * carries a single `vendorId`) → 409. Then create VENDOR_STAFF (idempotent) and mark accepted.
   */
  accept(userId: string, token: string): Promise<VendorInvitationAcceptResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const found = await tx.$queryRaw<LockedInvitation[]>`
        SELECT id, vendor_id, email, expires_at, accepted_at, revoked_at
        FROM vendor_invitations WHERE token_hash = ${hashToken(token)} FOR UPDATE`;
      const inv = found[0];
      if (!inv || inv.accepted_at || inv.revoked_at)
        throw new DomainError('invitation.error.invalid');
      if (inv.expires_at <= new Date()) throw new DomainError('invitation.error.expired');
      await assertVendorActive(tx, inv.vendor_id);

      const users = await tx.$queryRaw<{ email: string | null }[]>`
        SELECT email FROM users WHERE id = ${userId} FOR UPDATE`;
      const email = users[0]?.email;
      if (!email || email.toLowerCase() !== inv.email) {
        throw new DomainError('invitation.error.email-mismatch');
      }
      const other = await tx.userRole.count({
        where: {
          userId,
          role: { in: [...VENDOR_ROLES] },
          vendorId: { not: inv.vendor_id },
        },
      });
      if (other > 0) throw new DomainError('common.error.conflict', { field: 'vendor' });

      const existing = await tx.userRole.count({
        where: { userId, role: 'VENDOR_STAFF', vendorId: inv.vendor_id },
      });
      if (existing === 0) {
        const owner = await tx.userRole.count({
          where: { userId, role: 'VENDOR_OWNER', vendorId: inv.vendor_id },
        });
        if (owner === 0) {
          await tx.userRole.create({
            data: { id: ulid(), userId, role: 'VENDOR_STAFF', vendorId: inv.vendor_id },
          });
        }
      }
      await tx.vendorInvitation.update({
        where: { id: inv.id },
        data: { acceptedAt: new Date(), acceptedById: userId },
      });
      return VendorInvitationAcceptResultSchema.parse({ vendorId: inv.vendor_id });
    });
  }
}
