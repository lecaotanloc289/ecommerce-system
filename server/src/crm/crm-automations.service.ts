import { Injectable } from '@nestjs/common';
import {
  type CrmAutomation,
  type CrmAutomationKind,
  CrmAutomationKindSchema,
  CrmAutomationSchema,
  DomainError,
  type UpdateCrmAutomation,
  messageKindOf,
} from '@repo/core';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { assertVendorActive, isUniqueViolation } from '../vendor/vendor-scope';
import { assertCouponPlaceholder, assertCrmCoupon, assertVendorOwner } from './crm-access';

/** C8: allowed `delayDays` per automation, and the default shown before the shop saves a row. */
export const CRM_AUTOMATION_DELAY: Readonly<
  Record<CrmAutomationKind, { min: number; max: number; default: number }>
> = {
  THANK_YOU: { min: 0, max: 7, default: 1 },
  REVIEW_REQUEST: { min: 1, max: 30, default: 3 },
  REORDER_REMINDER: { min: 7, max: 180, default: 30 },
};

/** Only REORDER_REMINDER (MARKETING) may carry a coupon (C8). */
const COUPON_KINDS: ReadonlySet<CrmAutomationKind> = new Set(['REORDER_REMINDER']);

interface AutomationRow {
  kind: CrmAutomationKind;
  isEnabled: boolean;
  delayDays: number;
  templateVi: string | null;
  templateEn: string | null;
  couponId: string | null;
  updatedAt: Date;
}

const toAutomation = (row: AutomationRow): CrmAutomation =>
  CrmAutomationSchema.parse({
    kind: row.kind,
    messageKind: messageKindOf(row.kind),
    isEnabled: row.isEnabled,
    delayDays: row.delayDays,
    templateVi: row.templateVi,
    templateEn: row.templateEn,
    couponId: row.couponId,
    updatedAt: row.updatedAt.toISOString(),
  });

/** Post-purchase automations (C8): one row per vendor + kind, disabled until the owner saves one. */
@Injectable()
export class CrmAutomationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All three kinds, in enum order. A kind without a row is returned disabled with the default
   * delay; its `updatedAt` is the vendor's creation time (nothing was ever changed).
   */
  async list(vendorId: string): Promise<CrmAutomation[]> {
    const db = this.prisma.client;
    const [rows, vendor] = await Promise.all([
      db.crmAutomation.findMany({ where: { vendorId } }),
      db.vendor.findUnique({ where: { id: vendorId }, select: { createdAt: true } }),
    ]);
    if (!vendor) throw new DomainError('vendor.error.not-found');
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    return CrmAutomationKindSchema.options.map((kind) =>
      toAutomation(
        byKind.get(kind) ?? {
          kind,
          isEnabled: false,
          delayDays: CRM_AUTOMATION_DELAY[kind].default,
          templateVi: null,
          templateEn: null,
          couponId: null,
          updatedAt: vendor.createdAt,
        },
      ),
    );
  }

  /**
   * Owner only (C13). `delayDays` must be in the kind's range (C8) and a coupon is only allowed on
   * REORDER_REMINDER (else 422 `common.error.validation-failed {field}`); the coupon must be valid
   * now (`crm.error.coupon-invalid`); `{couponCode}` needs a coupon. Templates were already checked
   * for links / unknown placeholders by `CrmTemplateTextSchema`.
   */
  async update(
    userId: string,
    vendorId: string,
    kind: CrmAutomationKind,
    body: UpdateCrmAutomation,
  ): Promise<CrmAutomation> {
    const range = CRM_AUTOMATION_DELAY[kind];
    if (body.delayDays < range.min || body.delayDays > range.max) {
      throw new DomainError('common.error.validation-failed', {
        field: 'delayDays',
        min: range.min,
        max: range.max,
      });
    }
    if (body.couponId !== null && !COUPON_KINDS.has(kind)) {
      throw new DomainError('common.error.validation-failed', {
        field: 'couponId',
        reason: 'not-allowed-for-kind',
      });
    }
    assertCouponPlaceholder([body.templateVi, body.templateEn], body.couponId);

    const save = () =>
      this.prisma.client.$transaction(async (tx) => {
        await assertVendorOwner(tx, userId, vendorId);
        await assertVendorActive(tx, vendorId);
        if (body.couponId !== null) await assertCrmCoupon(tx, vendorId, body.couponId, new Date());
        const data = {
          isEnabled: body.isEnabled,
          delayDays: body.delayDays,
          templateVi: body.templateVi,
          templateEn: body.templateEn,
          couponId: body.couponId,
        };
        return tx.crmAutomation.upsert({
          where: { vendorId_kind: { vendorId, kind } },
          create: { id: ulid(), vendorId, kind, ...data },
          update: data,
        });
      });
    let row: Awaited<ReturnType<typeof save>>;
    try {
      row = await save();
    } catch (error) {
      // Two first saves of the same (vendor, kind) raced: the loser's INSERT hit the unique index
      // (a P2002 aborts the whole Postgres transaction). The row exists now, so retrying once takes
      // the UPDATE path; last writer wins, as for any concurrent PUT.
      if (!isUniqueViolation(error)) throw error;
      row = await save();
    }
    return toAutomation(row);
  }
}
