import { describe, it, expect, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { prisma } from '../src/client.js';
import { CRM_SEED_REFERENCE_DATE, SEED_IDS } from '../src/seed-ids.js';

// Valid orders per plan C1 (PAID, PROCESSING, SHIPPED, DELIVERED, COMPLETED). Rows the seed created
// are read-only here; constraint checks run in transactions that always roll back.
const rollback = new Error('rollback');
async function withRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    prisma.$transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

const CRM_CUSTOMER_IDS = [
  SEED_IDS.crmCustomerNew,
  SEED_IDS.crmCustomerReturning,
  SEED_IDS.crmCustomerVip,
  SEED_IDS.crmCustomerAtRisk,
  SEED_IDS.crmCustomerLapsed,
];

type Segment = 'NEW' | 'RETURNING' | 'VIP' | 'AT_RISK' | 'LAPSED';
// Mirror of plan C3 with the default PlatformSettings thresholds, explicit `now` (the real
// classifier lives in @repo/core; this keeps the seed test independent of it).
function segment(orders: number, lastAt: Date, now: Date): Segment {
  const days = (now.getTime() - lastAt.getTime()) / 86_400_000;
  if (days > 180) return 'LAPSED';
  if (days > 60) return 'AT_RISK';
  if (orders >= 3) return 'VIP';
  if (orders >= 2) return 'RETURNING';
  return 'NEW';
}

describe('vendor CRM schema + seed', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('PlatformSettings has the CRM defaults', async () => {
    const s = await prisma.platformSettings.findUniqueOrThrow({ where: { id: SEED_IDS.settings } });
    expect(s).toMatchObject({
      crmAtRiskAfterDays: 60,
      crmLapsedAfterDays: 180,
      crmVipMinOrders: 3,
      crmMaxCampaignsPerWeek: 2,
      crmMaxMarketingPerCustomerPerWeek: 2,
    });
  });

  it('seed demo customers of vendor A cover all 5 segments at the reference date', async () => {
    const subs = await prisma.subOrder.findMany({
      where: {
        vendorId: SEED_IDS.vendorA,
        status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'] },
        order: { customerId: { in: CRM_CUSTOMER_IDS } },
      },
      include: { order: true },
    });
    const byCustomer = new Map<string, Date[]>();
    for (const s of subs) {
      const list = byCustomer.get(s.order.customerId) ?? [];
      list.push(s.createdAt);
      byCustomer.set(s.order.customerId, list);
    }
    const seg = (id: string): Segment => {
      const dates = (byCustomer.get(id) ?? []).sort((a, b) => a.getTime() - b.getTime());
      return segment(dates.length, dates[dates.length - 1] as Date, CRM_SEED_REFERENCE_DATE);
    };
    expect(seg(SEED_IDS.crmCustomerNew)).toBe('NEW');
    expect(seg(SEED_IDS.crmCustomerReturning)).toBe('RETURNING');
    expect(seg(SEED_IDS.crmCustomerVip)).toBe('VIP');
    expect(seg(SEED_IDS.crmCustomerAtRisk)).toBe('AT_RISK'); // the newer CANCELLED order is ignored
    expect(seg(SEED_IDS.crmCustomerLapsed)).toBe('LAPSED');
  });

  it('seed money satisfies paid = subtotal + shipping - discount - platformDiscount', async () => {
    const subs = await prisma.subOrder.findMany({
      where: {
        vendorId: SEED_IDS.vendorA,
        id: { in: [SEED_IDS.crmSubOrderVip3, SEED_IDS.crmSubOrderReturning1] },
      },
      include: { order: true },
    });
    expect(subs).toHaveLength(2);
    for (const s of subs) {
      expect(s.order.grandTotalAmount).toBe(
        s.subtotalAmount + s.shippingAmount - s.discountAmount - s.platformDiscountAmount,
      );
    }
  });

  it('rejects a duplicate (campaignId, userId) CrmMessage', async () => {
    await withRollback(async (tx) => {
      const campaign = await tx.crmCampaign.create({
        data: {
          id: ulid(),
          vendorId: SEED_IDS.vendorA,
          name: 'c',
          audience: {},
          templateVi: 'xin chao',
          createdById: SEED_IDS.vendorAOwner,
        },
      });
      const base = {
        vendorId: SEED_IDS.vendorA,
        userId: SEED_IDS.crmCustomerVip,
        kind: 'MARKETING' as const,
        campaignId: campaign.id,
        channels: ['IN_APP' as const],
        scheduledFor: new Date(),
      };
      await tx.crmMessage.create({ data: { id: ulid(), ...base } });
      await expect(tx.crmMessage.create({ data: { id: ulid(), ...base } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  it('rejects a duplicate (automationKind, subOrderId) CrmMessage', async () => {
    await withRollback(async (tx) => {
      const base = {
        vendorId: SEED_IDS.vendorA,
        userId: SEED_IDS.crmCustomerNew,
        kind: 'SERVICE' as const,
        automationKind: 'THANK_YOU' as const,
        subOrderId: SEED_IDS.crmSubOrderNew1,
        channels: ['IN_APP' as const],
        scheduledFor: new Date(),
      };
      await tx.crmMessage.create({ data: { id: ulid(), ...base } });
      await expect(tx.crmMessage.create({ data: { id: ulid(), ...base } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  it('enforces the crm_messages single-source CHECK', async () => {
    const base = {
      vendorId: SEED_IDS.vendorA,
      userId: SEED_IDS.crmCustomerNew,
      kind: 'SERVICE' as const,
      channels: ['IN_APP' as const],
      scheduledFor: new Date(),
    };
    // neither source
    await withRollback(async (tx) => {
      await expect(tx.crmMessage.create({ data: { id: ulid(), ...base } })).rejects.toThrow();
    });
    // automation kind without sub-order
    await withRollback(async (tx) => {
      await expect(
        tx.crmMessage.create({ data: { id: ulid(), ...base, automationKind: 'THANK_YOU' } }),
      ).rejects.toThrow();
    });
    // automation + sub-order is fine
    await withRollback(async (tx) => {
      await tx.crmMessage.create({
        data: {
          id: ulid(),
          ...base,
          automationKind: 'THANK_YOU',
          subOrderId: SEED_IDS.crmSubOrderNew1,
        },
      });
    });
  });

  it('enforces the CRM PlatformSettings CHECKs', async () => {
    for (const data of [
      { crmAtRiskAfterDays: 0 },
      { crmLapsedAfterDays: 3651 },
      { crmAtRiskAfterDays: 200 }, // not < lapsed (180)
      { crmMaxCampaignsPerWeek: 0 },
    ]) {
      await withRollback(async (tx) => {
        await expect(
          tx.platformSettings.update({ where: { id: SEED_IDS.settings }, data }),
        ).rejects.toThrow();
      });
    }
  });

  it('keeps the due-messages partial index', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'crm_messages_due_idx'`;
    expect(rows[0]?.indexdef).toContain("WHERE (status = 'SCHEDULED'");
  });

  it('allows only one automation per (vendor, kind)', async () => {
    await withRollback(async (tx) => {
      await expect(
        tx.crmAutomation.create({
          data: { id: ulid(), vendorId: SEED_IDS.vendorA, kind: 'THANK_YOU', delayDays: 2 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
