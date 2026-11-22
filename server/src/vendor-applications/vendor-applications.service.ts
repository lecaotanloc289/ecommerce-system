import { Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  Role,
  VENDOR_APPLICATION_AGGREGATE_TYPE,
  type VendorApplication,
  type VendorApplicationCreate,
  type VendorApplicationListItem,
  VendorApplicationListItemSchema,
  type VendorApplicationDetail,
  VendorApplicationDetailSchema,
  type VendorApplicationListPage,
  VendorApplicationListPageSchema,
  type VendorApplicationListQuery,
  type VendorApplicationMe,
  VendorApplicationMeSchema,
  VendorApplicationApprovedEventSchema,
  VendorApplicationRejectedEventSchema,
  type VendorApplicationReviewResult,
  VendorApplicationReviewResultSchema,
  VendorApplicationSchema,
  type VendorApprove,
  type VendorReject,
} from '@repo/core';
import { ApplicationStatus, VendorStatus, type Prisma } from '@repo/db';
import { ulid } from 'ulid';
import type { z } from 'zod';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type Tx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

/** Own-history page size; applications are rare (one PENDING at a time), so no cursor. */
const MY_HISTORY_LIMIT = 20;

const WITH_APPLICANT = {
  include: { applicant: { select: { name: true } } },
} satisfies Prisma.VendorApplicationDefaultArgs;
type ApplicationRow = Prisma.VendorApplicationGetPayload<typeof WITH_APPLICANT>;

/** Masks all but the last 4 characters (`*` fill); values of 4 characters or fewer are fully masked. */
export function maskTail(value: string): string {
  const visible = value.slice(value.length - Math.min(4, Math.floor(value.length / 2)));
  return '*'.repeat(value.length - visible.length) + visible;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function toApplication(row: Prisma.VendorApplicationGetPayload<object>): VendorApplication {
  return VendorApplicationSchema.parse({
    id: row.id,
    applicantId: row.applicantId,
    status: row.status,
    businessLicenseKey: row.businessLicenseUrl,
    taxId: row.taxId,
    nationalIdNumber: row.nationalIdNumber,
    nationalIdKey: row.nationalIdUrl,
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    accountHolder: row.accountHolder,
    bankVerified: row.bankVerified,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
  });
}

function toListItem(row: ApplicationRow): z.input<typeof VendorApplicationListItemSchema> {
  return {
    id: row.id,
    applicantId: row.applicantId,
    applicantName: row.applicant.name,
    status: row.status,
    taxIdMasked: maskTail(row.taxId),
    nationalIdNumberMasked: maskTail(row.nationalIdNumber),
    bankName: row.bankName,
    bankAccountNumberMasked: maskTail(row.bankAccountNumber),
    accountHolder: row.accountHolder,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Vendor onboarding: the customer applies with KYC documents (upload keys), platform staff
 * approve or reject. KYC numbers are never logged. Approval is one transaction (see `approve`).
 */
@Injectable()
export class VendorApplicationsService {
  private readonly logger = new Logger(VendorApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Returns the masked row: the response body is cached by `@Idempotent()` (Redis, 24h), so it must not hold KYC numbers. */
  async create(userId: string, input: VendorApplicationCreate): Promise<VendorApplicationListItem> {
    // Keys must be ones this server issued for the caller (throws upload.error.invalid-key).
    const owner = { type: 'user', userId } as const;
    const businessLicenseKey = this.storage.assertOwnedKey(input.businessLicenseKey, owner);
    const nationalIdKey = this.storage.assertOwnedKey(input.nationalIdKey, owner);

    if (businessLicenseKey === nationalIdKey) throw new DomainError('upload.error.invalid-key');

    return this.prisma.client.$transaction(async (tx) => {
      // Serialises the caller's applications so two concurrent submits cannot both be PENDING.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE`;
      if (locked.length === 0) throw new DomainError('common.error.unauthorized');

      if (await tx.vendor.findFirst({ where: { ownerId: userId }, select: { id: true } })) {
        throw new DomainError('common.error.conflict');
      }
      const pending = await tx.vendorApplication.findFirst({
        where: { applicantId: userId, status: ApplicationStatus.PENDING },
        select: { id: true },
      });
      if (pending) throw new DomainError('vendor.error.application-already-pending');

      const applicant = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      });
      const applicantName = applicant.name;
      const row = await tx.vendorApplication.create({
        data: {
          id: ulid(),
          applicantId: userId,
          businessLicenseUrl: businessLicenseKey,
          taxId: input.taxId,
          nationalIdNumber: input.nationalIdNumber,
          nationalIdUrl: nationalIdKey,
          bankName: input.bankName,
          bankAccountNumber: input.bankAccountNumber,
          accountHolder: input.accountHolder,
        },
      });
      return VendorApplicationListItemSchema.parse(
        toListItem({ ...row, applicant: { name: applicantName } }),
      );
    });
  }

  async listMine(userId: string): Promise<VendorApplicationMe> {
    const rows = await this.prisma.client.vendorApplication.findMany({
      where: { applicantId: userId },
      orderBy: { id: 'desc' },
      take: MY_HISTORY_LIMIT,
    });
    const history = rows.map(toApplication);
    return VendorApplicationMeSchema.parse({ latest: history[0] ?? null, history });
  }

  async listForReview(query: VendorApplicationListQuery): Promise<VendorApplicationListPage> {
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.vendorApplication.findMany({
      ...args,
      where: { ...(query.status && { status: query.status }), ...args.where },
      ...WITH_APPLICANT,
    });
    const page = toPage(rows, query);
    return VendorApplicationListPageSchema.parse({
      items: page.items.map(toListItem),
      nextCursor: page.nextCursor,
    });
  }

  async getForReview(reviewerId: string, id: string): Promise<VendorApplicationDetail> {
    const row = await this.prisma.client.vendorApplication.findUnique({
      where: { id },
      ...WITH_APPLICANT,
    });
    if (!row) throw new DomainError('common.error.not-found');
    // Audit trail for reads of full KYC data (ids only, never values).
    this.logger.log({ reviewerId, applicationId: id }, 'vendor application KYC viewed');
    const [businessLicenseUrl, nationalIdUrl] = await Promise.all([
      this.storage.presignGet(row.businessLicenseUrl),
      this.storage.presignGet(row.nationalIdUrl),
    ]);
    return VendorApplicationDetailSchema.parse({
      ...toApplication(row),
      applicantName: row.applicant.name,
      reviewedById: row.reviewedById,
      businessLicenseUrl,
      nationalIdUrl,
    });
  }

  /**
   * One `$transaction`: lock the application row, require PENDING, mark APPROVED (+ reviewer),
   * create the ACTIVE Vendor, its Wallet (platform default currency, balance 0) and the
   * applicant's `VENDOR_OWNER` role, and write outbox `vendor.application.approved`. The applicant
   * sees the role from their next access-token refresh (roles are re-read then).
   */
  async approve(
    reviewerId: string,
    applicationId: string,
    input: VendorApprove,
  ): Promise<VendorApplicationReviewResult> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const row = await this.lockPending(tx, reviewerId, applicationId);
        const settings = await tx.platformSettings.findFirst({ orderBy: { createdAt: 'asc' } });
        if (!settings) throw new Error('PlatformSettings row is missing (run the seed)');

        const taken = await tx.vendor.findFirst({
          where: { OR: [{ slug: input.slug }, { ownerId: row.applicantId }] },
          select: { id: true },
        });
        if (taken) throw new DomainError('common.error.conflict');

        const vendorId = ulid();
        await tx.vendor.create({
          data: {
            id: vendorId,
            ownerId: row.applicantId,
            slug: input.slug,
            displayName: input.displayName,
            status: VendorStatus.ACTIVE,
            wallet: { create: { id: ulid(), balanceCurrency: settings.defaultCurrency } },
          },
        });
        await tx.userRole.create({
          data: { id: ulid(), userId: row.applicantId, role: Role.VENDOR_OWNER, vendorId },
        });
        const updated = await tx.vendorApplication.update({
          where: { id: applicationId },
          data: {
            status: ApplicationStatus.APPROVED,
            reviewedById: reviewerId,
            reviewedAt: new Date(),
          },
          ...WITH_APPLICANT,
        });
        await tx.outboxEvent.create({
          data: {
            id: ulid(),
            aggregateType: VENDOR_APPLICATION_AGGREGATE_TYPE,
            aggregateId: applicationId,
            eventType: 'vendor.application.approved',
            payload: VendorApplicationApprovedEventSchema.parse({
              applicationId,
              vendorId,
              userId: row.applicantId,
            }),
          },
        });
        return VendorApplicationReviewResultSchema.parse({ ...toListItem(updated), vendorId });
      });
    } catch (error) {
      // Slug / owner race that slipped past the pre-check: the unique index is the backstop.
      if (isUniqueViolation(error)) throw new DomainError('common.error.conflict');
      throw error;
    }
  }

  async reject(
    reviewerId: string,
    applicationId: string,
    input: VendorReject,
  ): Promise<VendorApplicationReviewResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const row = await this.lockPending(tx, reviewerId, applicationId);
      const updated = await tx.vendorApplication.update({
        where: { id: applicationId },
        data: {
          status: ApplicationStatus.REJECTED,
          rejectReason: input.reason,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
        },
        ...WITH_APPLICANT,
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: VENDOR_APPLICATION_AGGREGATE_TYPE,
          aggregateId: applicationId,
          eventType: 'vendor.application.rejected',
          payload: VendorApplicationRejectedEventSchema.parse({
            applicationId,
            userId: row.applicantId,
          }),
        },
      });
      return VendorApplicationReviewResultSchema.parse({ ...toListItem(updated), vendorId: null });
    });
  }

  /** `SELECT … FOR UPDATE` on the application; 404 if missing, 409 unless still PENDING. */
  private async lockPending(
    tx: Tx,
    reviewerId: string,
    applicationId: string,
  ): Promise<{ applicantId: string }> {
    const rows = await tx.$queryRaw<{ applicant_id: string; status: string }[]>`
      SELECT applicant_id, status::text AS status FROM vendor_applications
      WHERE id = ${applicationId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new DomainError('common.error.not-found');
    if (row.status !== ApplicationStatus.PENDING) {
      throw new DomainError('vendor.error.application-not-pending');
    }
    // Staff are also customers: they must not review their own application.
    if (row.applicant_id === reviewerId) throw new DomainError('common.error.forbidden');
    return { applicantId: row.applicant_id };
  }
}
