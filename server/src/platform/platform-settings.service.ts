import { Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type PlatformSettings,
  PlatformSettingsSchema,
  type PlatformSettingsUpdate,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { PrismaService } from '../prisma/prisma.service';
import { assertPlatformAdmin } from './platform-admin-guard';

type SettingsRow = Prisma.PlatformSettingsGetPayload<object>;

function toSettings(row: SettingsRow): PlatformSettings {
  return PlatformSettingsSchema.parse({
    id: row.id,
    commissionBps: row.commissionBps,
    holdPeriodDays: row.holdPeriodDays,
    refundWindowDays: row.refundWindowDays,
    maxCouponStack: row.maxCouponStack,
    paymentTimeoutMinutes: row.paymentTimeoutMinutes,
    supportedCurrencies: row.supportedCurrencies,
    defaultCurrency: row.defaultCurrency,
    crmAtRiskAfterDays: row.crmAtRiskAfterDays,
    crmLapsedAfterDays: row.crmLapsedAfterDays,
    crmVipMinOrders: row.crmVipMinOrders,
    crmMaxCampaignsPerWeek: row.crmMaxCampaignsPerWeek,
    crmMaxMarketingPerCustomerPerWeek: row.crmMaxMarketingPerCustomerPerWeek,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Singleton `PlatformSettings` row: read for staff, tune for admins. */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    const row = await this.prisma.client.platformSettings.findFirst({ orderBy: { id: 'asc' } });
    if (!row) throw new DomainError('common.error.internal', { reason: 'settings-missing' });
    return toSettings(row);
  }

  /**
   * Partial update. The row is locked first so two admins cannot interleave a read-merge-write;
   * the merged result must keep `defaultCurrency` inside `supportedCurrencies` (the schema can only
   * check that when both are sent).
   */
  async update(adminId: string, body: PlatformSettingsUpdate): Promise<PlatformSettings> {
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await assertPlatformAdmin(tx, adminId);
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM platform_settings ORDER BY id LIMIT 1 FOR UPDATE`;
      const id = locked[0]?.id;
      if (id === undefined)
        throw new DomainError('common.error.internal', { reason: 'settings-missing' });
      const current = await tx.platformSettings.findUniqueOrThrow({ where: { id } });
      const supported = body.supportedCurrencies ?? current.supportedCurrencies;
      const defaultCurrency = body.defaultCurrency ?? current.defaultCurrency;
      if (!supported.includes(defaultCurrency)) {
        throw new DomainError('common.error.validation-failed', {
          field: 'defaultCurrency',
          reason: 'not-supported',
        });
      }
      // Same merge rule for the CRM segment thresholds (the DB CHECK also enforces it).
      const atRisk = body.crmAtRiskAfterDays ?? current.crmAtRiskAfterDays;
      const lapsed = body.crmLapsedAfterDays ?? current.crmLapsedAfterDays;
      if (atRisk >= lapsed) {
        throw new DomainError('common.error.validation-failed', {
          field: 'crmAtRiskAfterDays',
          reason: 'not-below-lapsed',
        });
      }
      const data: Prisma.PlatformSettingsUpdateInput = {
        ...(body.commissionBps !== undefined && { commissionBps: body.commissionBps }),
        ...(body.holdPeriodDays !== undefined && { holdPeriodDays: body.holdPeriodDays }),
        ...(body.refundWindowDays !== undefined && { refundWindowDays: body.refundWindowDays }),
        ...(body.maxCouponStack !== undefined && { maxCouponStack: body.maxCouponStack }),
        ...(body.paymentTimeoutMinutes !== undefined && {
          paymentTimeoutMinutes: body.paymentTimeoutMinutes,
        }),
        ...(body.supportedCurrencies !== undefined && {
          supportedCurrencies: body.supportedCurrencies,
        }),
        ...(body.defaultCurrency !== undefined && { defaultCurrency: body.defaultCurrency }),
        ...(body.crmAtRiskAfterDays !== undefined && {
          crmAtRiskAfterDays: body.crmAtRiskAfterDays,
        }),
        ...(body.crmLapsedAfterDays !== undefined && {
          crmLapsedAfterDays: body.crmLapsedAfterDays,
        }),
        ...(body.crmVipMinOrders !== undefined && { crmVipMinOrders: body.crmVipMinOrders }),
        ...(body.crmMaxCampaignsPerWeek !== undefined && {
          crmMaxCampaignsPerWeek: body.crmMaxCampaignsPerWeek,
        }),
        ...(body.crmMaxMarketingPerCustomerPerWeek !== undefined && {
          crmMaxMarketingPerCustomerPerWeek: body.crmMaxMarketingPerCustomerPerWeek,
        }),
      };
      return tx.platformSettings.update({ where: { id }, data });
    });
    this.logger.log({ adminId, fields: Object.keys(body) }, 'platform settings updated');
    return toSettings(updated);
  }
}
