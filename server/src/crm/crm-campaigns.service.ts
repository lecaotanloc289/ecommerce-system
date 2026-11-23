import { Injectable, Logger } from '@nestjs/common';
import {
  CRM_CAMPAIGN_AGGREGATE_TYPE,
  CRM_MAX_CAMPAIGN_AHEAD_DAYS,
  type CreateCrmCampaign,
  type CrmAudienceFilter,
  CrmAudienceFilterSchema,
  type CrmCampaign,
  type CrmCampaignPage,
  CrmCampaignPageSchema,
  type CrmCampaignPreview,
  CrmCampaignPreviewSchema,
  CrmCampaignSchema,
  type CrmCampaignStatus,
  CrmCampaignScheduledEventSchema,
  DomainError,
  type PageQuery,
  type PlatformCrmCampaignListQuery,
  type ScheduleCrmCampaign,
  type UpdateCrmCampaign,
  renderCrmTemplate,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { assertVendorActive } from '../vendor/vendor-scope';
import { assertCouponPlaceholder, assertCrmCoupon, assertVendorOwner } from './crm-access';
import { CrmCustomersRepository } from './crm-customers.repository';

const MS_PER_DAY = 86_400_000;
const LIMIT_WINDOW_MS = 7 * MS_PER_DAY;
/** Statuses that count towards the weekly campaign limit (C10). */
const LIMIT_STATUSES: readonly CrmCampaignStatus[] = ['SCHEDULED', 'SENDING', 'SENT'];
const CANCELLABLE: readonly CrmCampaignStatus[] = ['DRAFT', 'SCHEDULED'];
/** Schedule runs the audience query under locks: bound how long it may wait and run. */
const SCHEDULE_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
/** Sample recipient name for the preview render (plan K4a). */
const PREVIEW_CUSTOMER_NAME = 'Minh';

type CampaignRow = Prisma.CrmCampaignGetPayload<object>;

interface CampaignStats {
  sent: number;
  skipped: number;
  failed: number;
  couponRedemptions: number;
}

const EMPTY_STATS: CampaignStats = { sent: 0, skipped: 0, failed: 0, couponRedemptions: 0 };

function audienceOf(row: CampaignRow): CrmAudienceFilter {
  const parsed = CrmAudienceFilterSchema.safeParse(row.audience);
  if (!parsed.success) {
    throw new DomainError('common.error.internal', { reason: 'campaign-audience-invalid' });
  }
  return parsed.data;
}

function toCampaign(row: CampaignRow, stats: CampaignStats): CrmCampaign {
  const iso = (d: Date | null) => (d === null ? null : d.toISOString());
  return CrmCampaignSchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    audience: audienceOf(row),
    templateVi: row.templateVi,
    templateEn: row.templateEn,
    couponId: row.couponId,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    recipientCount: row.recipientCount,
    createdAt: row.createdAt.toISOString(),
    stats,
  });
}

/**
 * `limit + 1` instants closer together than 7 days would put `limit + 1` campaigns in one sliding
 * 7-day window (C10). `times` must be sorted ascending.
 */
export function exceedsWeeklyLimit(times: readonly number[], limit: number): boolean {
  for (let i = 0; i + limit < times.length; i += 1) {
    const first = times[i];
    const last = times[i + limit];
    if (first !== undefined && last !== undefined && last - first < LIMIT_WINDOW_MS) return true;
  }
  return false;
}

/**
 * Vendor CRM campaigns (C10): DRAFT → SCHEDULED (→ SENDING → SENT by the K5 worker), cancellable
 * while DRAFT / SCHEDULED. Every transition is a guarded `updateMany … WHERE status = <from>`
 * inside a `$transaction`, so a concurrent move (worker, platform cancel) makes this one 409.
 */
@Injectable()
export class CrmCampaignsService {
  private readonly logger = new Logger(CrmCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CrmCustomersRepository,
  ) {}

  async list(vendorId: string, query: PageQuery): Promise<CrmCampaignPage> {
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.crmCampaign.findMany({
      ...args,
      where: { vendorId, ...args.where },
    });
    return this.page(rows, query);
  }

  async platformList(query: PlatformCrmCampaignListQuery): Promise<CrmCampaignPage> {
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.crmCampaign.findMany({
      ...args,
      where: {
        ...(query.vendorId !== undefined && { vendorId: query.vendorId }),
        ...(query.status !== undefined && { status: query.status }),
        ...args.where,
      },
    });
    return this.page(rows, query);
  }

  async get(vendorId: string, id: string): Promise<CrmCampaign> {
    const row = await this.prisma.client.crmCampaign.findFirst({ where: { id, vendorId } });
    if (!row) throw new DomainError('crm.error.campaign-not-found');
    return this.one(row);
  }

  /** New DRAFT (owner or staff). The coupon must be valid now; `{couponCode}` needs a coupon. */
  async create(userId: string, vendorId: string, body: CreateCrmCampaign): Promise<CrmCampaign> {
    assertCouponPlaceholder([body.templateVi, body.templateEn], body.couponId);
    const row = await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      if (body.couponId !== null) await assertCrmCoupon(tx, vendorId, body.couponId, new Date());
      return tx.crmCampaign.create({
        data: {
          id: ulid(),
          vendorId,
          name: body.name,
          audience: body.audience,
          templateVi: body.templateVi,
          templateEn: body.templateEn,
          couponId: body.couponId,
          createdById: userId,
        },
      });
    });
    return toCampaign(row, EMPTY_STATS);
  }

  /**
   * Full replace of a DRAFT; any other status → 409 `crm.error.campaign-not-editable`. Locks the
   * row first, so it serialises with schedule / cancel (see `lockCampaign`).
   */
  async update(vendorId: string, id: string, body: UpdateCrmCampaign): Promise<CrmCampaign> {
    assertCouponPlaceholder([body.templateVi, body.templateEn], body.couponId);
    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const row = await this.lockCampaign(tx, id, vendorId);
      if (row.status !== 'DRAFT') throw new DomainError('crm.error.campaign-not-editable');
      if (body.couponId !== null) await assertCrmCoupon(tx, vendorId, body.couponId, new Date());
      const { count } = await tx.crmCampaign.updateMany({
        where: { id, vendorId, status: 'DRAFT' },
        data: {
          name: body.name,
          audience: body.audience,
          templateVi: body.templateVi,
          templateEn: body.templateEn,
          couponId: body.couponId,
        },
      });
      if (count === 0) await this.notFoundOrNotEditable(tx, { id, vendorId });
    });
    return this.get(vendorId, id);
  }

  /**
   * Audience size now + sample render. `matchedCustomers` = customers matching the filter,
   * `eligibleRecipients` = those with marketing consent (who would actually receive it).
   */
  async preview(vendorId: string, id: string): Promise<CrmCampaignPreview> {
    const db = this.prisma.client;
    const row = await db.crmCampaign.findFirst({
      where: { id, vendorId },
      include: { vendor: { select: { displayName: true } }, coupon: { select: { code: true } } },
    });
    if (!row) throw new DomainError('crm.error.campaign-not-found');
    const counts = await this.customers.audienceCounts(db, vendorId, audienceOf(row), new Date());
    const values = {
      customerName: PREVIEW_CUSTOMER_NAME,
      shopName: row.vendor.displayName,
      couponCode: row.coupon?.code,
    };
    return CrmCampaignPreviewSchema.parse({
      matchedCustomers: counts.matched,
      eligibleRecipients: counts.eligible,
      sample: {
        vi: renderCrmTemplate(row.templateVi, values),
        en: renderCrmTemplate(row.templateEn ?? row.templateVi, values),
      },
    });
  }

  /**
   * Owner only: DRAFT → SCHEDULED at `scheduledAt` (null = now; not in the past, ≤ 30 days ahead).
   * In one transaction, serialised per vendor (advisory lock): vendor ACTIVE, coupon valid at the
   * send time, `{couponCode}` ⇒ coupon, weekly limit (429), non-empty eligible audience now (422),
   * guarded transition, outbox `crm.campaign.scheduled` (`nextAttemptAt` = send time).
   */
  async schedule(
    userId: string,
    vendorId: string,
    id: string,
    body: ScheduleCrmCampaign,
  ): Promise<CrmCampaign> {
    const now = new Date();
    const sendAt = body.scheduledAt === null ? now : new Date(body.scheduledAt);
    if (sendAt.getTime() < now.getTime()) {
      throw new DomainError('common.error.validation-failed', {
        field: 'scheduledAt',
        reason: 'in-past',
      });
    }
    if (sendAt.getTime() > now.getTime() + CRM_MAX_CAMPAIGN_AHEAD_DAYS * MS_PER_DAY) {
      throw new DomainError('common.error.validation-failed', {
        field: 'scheduledAt',
        reason: 'too-far',
        maxDays: CRM_MAX_CAMPAIGN_AHEAD_DAYS,
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorOwner(tx, userId, vendorId);
      await assertVendorActive(tx, vendorId);
      // Two schedules of the same vendor must not both pass the weekly limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-campaign-schedule:${vendorId}`}, 0))`;

      // Validate the LOCKED row: a concurrent PUT either committed before (we see its content)
      // or waits and then fails the DRAFT check — content is never scheduled unvalidated.
      const row = await this.lockCampaign(tx, id, vendorId);
      if (row.status !== 'DRAFT') throw new DomainError('crm.error.campaign-not-editable');
      assertCouponPlaceholder([row.templateVi, row.templateEn], row.couponId);
      if (row.couponId !== null) await assertCrmCoupon(tx, vendorId, row.couponId, sendAt);

      await this.assertWeeklyLimit(tx, vendorId, id, sendAt);

      if (!(await this.customers.hasEligibleAudience(tx, vendorId, audienceOf(row), now))) {
        throw new DomainError('crm.error.empty-audience');
      }

      const { count } = await tx.crmCampaign.updateMany({
        where: { id, vendorId, status: 'DRAFT' },
        data: { status: 'SCHEDULED', scheduledAt: sendAt },
      });
      if (count === 0) throw new DomainError('crm.error.campaign-not-editable');
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: CRM_CAMPAIGN_AGGREGATE_TYPE,
          aggregateId: id,
          eventType: 'crm.campaign.scheduled',
          payload: CrmCampaignScheduledEventSchema.parse({ campaignId: id, vendorId }),
          nextAttemptAt: sendAt,
        },
      });
    }, SCHEDULE_TX_OPTIONS);
    return this.get(vendorId, id);
  }

  /** Owner only: DRAFT / SCHEDULED → CANCELLED (+ its SCHEDULED messages SKIPPED). */
  async cancel(userId: string, vendorId: string, id: string): Promise<CrmCampaign> {
    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorOwner(tx, userId, vendorId);
      await assertVendorActive(tx, vendorId);
      await this.cancelLocked(tx, id, vendorId, null);
    });
    return this.get(vendorId, id);
  }

  /** Platform staff / admin (abuse control): same transition, with a reason. */
  async platformCancel(actorId: string, id: string, reason: string): Promise<CrmCampaign> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.cancelLocked(tx, id, null, reason);
      return tx.crmCampaign.findUniqueOrThrow({ where: { id } });
    });
    this.logger.log({ actorId, campaignId: id, vendorId: row.vendorId }, 'crm campaign cancelled');
    return this.one(row);
  }

  /**
   * `SELECT … FOR UPDATE` on the campaign row (scoped to `vendorId` unless null = platform), then
   * the row as committed. Every writer (update / schedule / cancel; the K5 worker's SCHEDULED →
   * SENDING must do the same) locks it first, so their checks and transition cannot interleave.
   */
  private async lockCampaign(
    tx: Prisma.TransactionClient,
    id: string,
    vendorId: string | null,
  ): Promise<CampaignRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM crm_campaigns
      WHERE id = ${id} AND (${vendorId}::text IS NULL OR vendor_id = ${vendorId}::text)
      FOR UPDATE`;
    if (locked.length === 0) throw new DomainError('crm.error.campaign-not-found');
    return tx.crmCampaign.findUniqueOrThrow({ where: { id } });
  }

  private async cancelLocked(
    tx: Prisma.TransactionClient,
    id: string,
    vendorId: string | null,
    reason: string | null,
  ): Promise<void> {
    const row = await this.lockCampaign(tx, id, vendorId);
    if (!CANCELLABLE.includes(row.status)) {
      throw new DomainError('crm.error.campaign-not-editable');
    }
    const { count } = await tx.crmCampaign.updateMany({
      where: { id, status: { in: [...CANCELLABLE] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
    });
    if (count === 0) throw new DomainError('crm.error.campaign-not-editable');
    await tx.crmMessage.updateMany({
      where: { campaignId: id, status: 'SCHEDULED' },
      data: { status: 'SKIPPED', skipReason: 'CAMPAIGN_CANCELLED' },
    });
  }

  /** Throws 404 if the (scoped) campaign does not exist, else 409 not-editable. */
  private async notFoundOrNotEditable(
    tx: Prisma.TransactionClient,
    where: { id: string; vendorId?: string },
  ): Promise<never> {
    const exists = await tx.crmCampaign.count({ where });
    throw new DomainError(
      exists === 0 ? 'crm.error.campaign-not-found' : 'crm.error.campaign-not-editable',
    );
  }

  /** C10: ≤ `crmMaxCampaignsPerWeek` campaigns sent in any sliding 7-day window. */
  private async assertWeeklyLimit(
    tx: Prisma.TransactionClient,
    vendorId: string,
    id: string,
    sendAt: Date,
  ): Promise<void> {
    const settings = await tx.platformSettings.findFirst({
      orderBy: { id: 'asc' },
      select: { crmMaxCampaignsPerWeek: true },
    });
    if (!settings) throw new DomainError('common.error.internal', { reason: 'settings-missing' });
    const limit = settings.crmMaxCampaignsPerWeek;
    const others = await tx.crmCampaign.findMany({
      where: {
        vendorId,
        id: { not: id },
        status: { in: [...LIMIT_STATUSES] },
        scheduledAt: {
          gt: new Date(sendAt.getTime() - LIMIT_WINDOW_MS),
          lt: new Date(sendAt.getTime() + LIMIT_WINDOW_MS),
        },
      },
      select: { scheduledAt: true },
    });
    const times = [
      sendAt.getTime(),
      ...others.flatMap((o) => (o.scheduledAt === null ? [] : [o.scheduledAt.getTime()])),
    ].sort((a, b) => a - b);
    if (exceedsWeeklyLimit(times, limit)) {
      throw new DomainError('crm.error.campaign-limit-reached', { limit });
    }
  }

  private async one(row: CampaignRow): Promise<CrmCampaign> {
    const stats = await this.stats([row.id]);
    return toCampaign(row, stats.get(row.id) ?? EMPTY_STATS);
  }

  private async page(rows: CampaignRow[], query: PageQuery): Promise<CrmCampaignPage> {
    const page = toPage(rows, query);
    const stats = await this.stats(page.items.map((r) => r.id));
    return CrmCampaignPageSchema.parse({
      items: page.items.map((r) => toCampaign(r, stats.get(r.id) ?? EMPTY_STATS)),
      nextCursor: page.nextCursor,
    });
  }

  /**
   * Message outcome counts + coupon redemptions attributed to the campaign: redemptions of the
   * campaign's coupon by a recipient after the message was sent to them.
   */
  private async stats(ids: readonly string[]): Promise<Map<string, CampaignStats>> {
    const result = new Map<string, CampaignStats>();
    if (ids.length === 0) return result;
    const db = this.prisma.client;
    const [groups, redemptions] = await Promise.all([
      db.crmMessage.groupBy({
        by: ['campaignId', 'status'],
        where: { campaignId: { in: [...ids] } },
        _count: { _all: true },
      }),
      db.$queryRaw<{ campaign_id: string; redemptions: number }[]>`
        SELECT m.campaign_id, COUNT(DISTINCT cr.id)::int AS redemptions
        FROM crm_messages m
        JOIN crm_campaigns c ON c.id = m.campaign_id
        JOIN coupon_redemptions cr
          ON cr.coupon_id = c.coupon_id AND cr.user_id = m.user_id AND cr.redeemed_at >= m.sent_at
        WHERE m.campaign_id = ANY(${[...ids]}::text[]) AND m.status = 'SENT'
        GROUP BY m.campaign_id`,
    ]);
    const get = (id: string): CampaignStats => {
      const existing = result.get(id);
      if (existing) return existing;
      const fresh = { ...EMPTY_STATS };
      result.set(id, fresh);
      return fresh;
    };
    for (const g of groups) {
      if (g.campaignId === null) continue;
      const s = get(g.campaignId);
      if (g.status === 'SENT') s.sent += g._count._all;
      else if (g.status === 'SKIPPED') s.skipped += g._count._all;
      else if (g.status === 'FAILED') s.failed += g._count._all;
    }
    for (const r of redemptions) get(r.campaign_id).couponRedemptions = r.redemptions;
    return result;
  }
}
