import { CrmAudienceFilterSchema } from '@repo/core';
import { crmAudienceIds, crmSegmentThresholds, prisma } from '@repo/db';
import { ulid } from 'ulid';
import type { Logger } from '../logger';
import type { Tx } from '../outbox/handler';
import { CRM_CHANNELS } from './automations';
import { validCrmCouponCode } from './consent';

/** `crm_messages` rows inserted per statement when a campaign starts. */
export const CAMPAIGN_INSERT_BATCH = 500;

/** Why the worker cancelled a due campaign instead of sending it (stored in `cancel_reason`). */
export type CampaignCancelReason = 'vendor-inactive' | 'coupon-invalid' | 'audience-invalid';

export type CampaignStartOutcome =
  | { outcome: 'started'; recipients: number }
  | { outcome: 'cancelled'; reason: CampaignCancelReason }
  | { outcome: 'not-due' };

interface LockedCampaign {
  vendorId: string;
  status: string;
  due: boolean;
  audience: unknown;
  couponId: string | null;
  dbNow: Date;
}

/**
 * Starts one due campaign (C10), inside `tx`: lock the row `FOR UPDATE` (the API's update /
 * schedule / cancel take the same lock, so a cancel either committed first — status no longer
 * SCHEDULED, nothing done — or waits and then finds it SENDING and gets 409) → must still be
 * SCHEDULED with `scheduledAt ≤ now` (DB clock), else `not-due` (nothing written) → vendor must be
 * ACTIVE and the attached coupon still valid now, else CANCELLED with `cancelReason` → audience
 * resolved NOW (`crmAudienceIds`: customers ∩ filter ∩ marketing consent) → SENDING + `startedAt`
 * + `recipientCount` → one MARKETING message per recipient (`scheduledFor` = now), inserted in
 * batches with `skipDuplicates` on the unique `(campaign_id, user_id)`. Messages are re-checked one
 * by one when sent (`dispatchMessage`); the campaign becomes SENT once none is SCHEDULED
 * (`finishSentCampaigns`).
 */
export async function startCampaign(
  tx: Tx,
  campaignId: string,
  log: Logger,
): Promise<CampaignStartOutcome> {
  const [campaign] = await tx.$queryRaw<LockedCampaign[]>`
    SELECT vendor_id AS "vendorId", status::text AS status, audience, coupon_id AS "couponId",
           (scheduled_at IS NOT NULL AND scheduled_at <= (now() AT TIME ZONE 'UTC')) AS due,
           (now() AT TIME ZONE 'UTC') AS "dbNow"
    FROM crm_campaigns WHERE id = ${campaignId} FOR UPDATE`;
  if (!campaign || campaign.status !== 'SCHEDULED' || !campaign.due) return { outcome: 'not-due' };
  const now = campaign.dbNow;

  const cancel = async (reason: CampaignCancelReason): Promise<CampaignStartOutcome> => {
    await tx.crmCampaign.updateMany({
      where: { id: campaignId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
    });
    log.warn(
      { campaignId, vendorId: campaign.vendorId, reason },
      'crm campaign cancelled at send time',
    );
    return { outcome: 'cancelled', reason };
  };

  const vendor = await tx.vendor.findUnique({
    where: { id: campaign.vendorId },
    select: { status: true },
  });
  if (vendor?.status !== 'ACTIVE') return cancel('vendor-inactive');
  if (
    campaign.couponId !== null &&
    (await validCrmCouponCode(tx, campaign.vendorId, campaign.couponId, now)) === null
  ) {
    return cancel('coupon-invalid');
  }
  const filter = CrmAudienceFilterSchema.safeParse(campaign.audience);
  if (!filter.success) return cancel('audience-invalid');

  const recipients = await crmAudienceIds(
    tx,
    campaign.vendorId,
    filter.data,
    now,
    await crmSegmentThresholds(tx),
    null,
  );
  await tx.crmCampaign.updateMany({
    where: { id: campaignId, status: 'SCHEDULED' },
    data: { status: 'SENDING', startedAt: now, recipientCount: recipients.length },
  });
  for (let i = 0; i < recipients.length; i += CAMPAIGN_INSERT_BATCH) {
    await tx.crmMessage.createMany({
      data: recipients.slice(i, i + CAMPAIGN_INSERT_BATCH).map((userId) => ({
        id: ulid(),
        vendorId: campaign.vendorId,
        userId,
        kind: 'MARKETING' as const,
        campaignId,
        channels: CRM_CHANNELS,
        scheduledFor: now,
      })),
      skipDuplicates: true,
    });
  }
  log.info({ campaignId, recipients: recipients.length }, 'crm campaign started');
  return { outcome: 'started', recipients: recipients.length };
}

/**
 * SENDING campaigns with no SCHEDULED message left → SENT + `completedAt` (DB clock). One
 * statement, safe to run concurrently and repeatedly. Returns how many campaigns finished.
 */
export async function finishSentCampaigns(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE crm_campaigns c
    SET status = 'SENT', completed_at = (now() AT TIME ZONE 'UTC'),
        updated_at = (now() AT TIME ZONE 'UTC')
    WHERE c.status = 'SENDING'
      AND NOT EXISTS (
        SELECT 1 FROM crm_messages m WHERE m.campaign_id = c.id AND m.status = 'SCHEDULED')`;
}
