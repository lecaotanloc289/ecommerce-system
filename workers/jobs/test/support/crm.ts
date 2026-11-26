import {
  deriveUnsubscribeToken,
  hashUnsubscribeToken,
  type CrmAutomationKind,
  type CrmAudienceFilter,
} from '@repo/core';
import type { CrmCampaignStatus, CrmChannel, SubOrderStatus } from '@repo/db';
import { ulid } from 'ulid';
import type { CrmDispatchDeps } from '../../src/crm/dispatch';
import { makeUser, prisma, type FakeMailer } from './fixtures';

// Fixtures for the CRM worker tests (vendor CRM K5): a shop with one product, purchases in any
// state, automations, consent, coupons, campaigns and raw `crm_messages` rows.

export const CRM_SECRET = 'test-crm-unsubscribe-secret-0123456789abcdef';

export function crmDeps(mailer: FakeMailer): CrmDispatchDeps {
  return {
    mailer,
    webOrigin: 'http://web.test',
    apiPublicUrl: 'http://api.test',
    unsubscribeSecret: CRM_SECRET,
    emailEnabled: true,
  };
}

export type User = Awaited<ReturnType<typeof makeUser>>;
export type Shop = Awaited<ReturnType<typeof makeCrmShop>>;

const DAY_MS = 86_400_000;
export const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

export async function makeCrmShop(data: { status?: 'ACTIVE' | 'SUSPENDED'; name?: string } = {}) {
  const owner = await makeUser({ name: 'Shop Owner' });
  const vendorId = ulid();
  const vendor = await prisma.vendor.create({
    data: {
      id: vendorId,
      ownerId: owner.id,
      slug: `shop-${vendorId.toLowerCase()}`,
      displayName: data.name ?? 'Lotus Shop',
      status: data.status ?? 'ACTIVE',
    },
  });
  const product = await prisma.product.create({
    data: { id: ulid(), vendorId, status: 'ACTIVE', basePriceAmount: 50_000n },
  });
  const variant = await prisma.productVariant.create({
    data: { id: ulid(), productId: product.id, sku: `SKU-${ulid()}`, priceAmount: 50_000n },
  });
  return { vendor, product, variant };
}

/** A customer's order with one sub-order (one line of the shop's product). */
export async function makePurchase(
  shop: Shop,
  data: {
    customer?: User;
    status?: SubOrderStatus;
    createdAt?: Date;
    deliveredAt?: Date | null;
    completedAt?: Date | null;
  } = {},
) {
  const customer = data.customer ?? (await makeUser({ name: 'Lan Nguyen' }));
  const createdAt = data.createdAt ?? daysAgo(10);
  const order = await prisma.order.create({
    data: {
      id: ulid(),
      customerId: customer.id,
      status: 'PAID',
      currency: 'VND',
      itemsTotalAmount: 100_000n,
      shippingTotalAmount: 0n,
      grandTotalAmount: 100_000n,
      idempotencyKey: ulid(),
      createdAt,
    },
  });
  const subOrder = await prisma.subOrder.create({
    data: {
      id: ulid(),
      orderId: order.id,
      vendorId: shop.vendor.id,
      status: data.status ?? 'DELIVERED',
      subtotalAmount: 100_000n,
      shippingAmount: 0n,
      currency: 'VND',
      shippingAddress: { recipientName: 'Lan', city: 'HCM' },
      createdAt,
      deliveredAt: data.deliveredAt === undefined ? daysAgo(1) : data.deliveredAt,
      completedAt: data.completedAt ?? null,
      items: {
        create: {
          id: ulid(),
          variantId: shop.variant.id,
          productTitleSnapshot: 'Basic tee',
          variantAttributesSnapshot: {},
          unitPriceAmount: 100_000n,
          quantity: 1,
          lineTotalAmount: 100_000n,
          currency: 'VND',
        },
      },
    },
  });
  return { customer, order, subOrder };
}

export function setAutomation(
  vendorId: string,
  kind: CrmAutomationKind,
  data: {
    isEnabled?: boolean;
    delayDays?: number;
    templateVi?: string | null;
    templateEn?: string | null;
    couponId?: string | null;
  } = {},
) {
  const values = {
    isEnabled: data.isEnabled ?? true,
    delayDays: data.delayDays ?? (kind === 'REORDER_REMINDER' ? 30 : 1),
    templateVi: data.templateVi ?? null,
    templateEn: data.templateEn ?? null,
    couponId: data.couponId ?? null,
  };
  return prisma.crmAutomation.upsert({
    where: { vendorId_kind: { vendorId, kind } },
    create: { id: ulid(), vendorId, kind, ...values },
    update: values,
  });
}

/** Writes the preference row (with the real token hash) in the given consent state. */
export async function setConsent(
  userId: string,
  vendorId: string,
  data: {
    marketingOptInAt?: Date | null;
    marketingOptOutAt?: Date | null;
    serviceOptOutAt?: Date | null;
  },
) {
  const unsubscribeTokenHash = await hashUnsubscribeToken(
    await deriveUnsubscribeToken(CRM_SECRET, userId, vendorId),
  );
  const values = {
    marketingOptInAt: data.marketingOptInAt ?? null,
    marketingOptInSource: data.marketingOptInAt ? ('STOREFRONT' as const) : null,
    marketingOptOutAt: data.marketingOptOutAt ?? null,
    serviceOptOutAt: data.serviceOptOutAt ?? null,
  };
  return prisma.customerVendorPreference.upsert({
    where: { userId_vendorId: { userId, vendorId } },
    create: { userId, vendorId, unsubscribeTokenHash, ...values },
    update: values,
  });
}

export const optIn = (userId: string, vendorId: string) =>
  setConsent(userId, vendorId, { marketingOptInAt: daysAgo(30) });

export function makeVendorCoupon(
  vendorId: string,
  data: { code?: string; endsAt?: Date; isActive?: boolean } = {},
) {
  return prisma.coupon.create({
    data: {
      id: ulid(),
      scope: 'VENDOR',
      vendorId,
      code: data.code ?? 'COMEBACK10',
      discountType: 'PERCENT',
      discountValue: 1000n,
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: data.endsAt ?? new Date('2030-01-01T00:00:00Z'),
      isActive: data.isActive ?? true,
    },
  });
}

export const ALL_CUSTOMERS: CrmAudienceFilter = {
  segments: [],
  tags: [],
  boughtProductIds: [],
  lastOrderWithinDays: null,
};

export function makeCampaign(
  vendorId: string,
  data: {
    status?: CrmCampaignStatus;
    scheduledAt?: Date | null;
    audience?: CrmAudienceFilter;
    templateVi?: string;
    templateEn?: string | null;
    couponId?: string | null;
  } = {},
) {
  return prisma.crmCampaign.create({
    data: {
      id: ulid(),
      vendorId,
      name: 'Winter sale',
      status: data.status ?? 'SCHEDULED',
      audience: data.audience ?? ALL_CUSTOMERS,
      templateVi: data.templateVi ?? 'Chào {customerName}, {shopName} có ưu đãi mới!',
      templateEn: data.templateEn ?? null,
      couponId: data.couponId ?? null,
      scheduledAt: data.scheduledAt === undefined ? daysAgo(0.001) : data.scheduledAt,
    },
  });
}

/** A raw message row, due a minute ago unless overridden. */
export function insertMessage(data: {
  vendorId: string;
  userId: string;
  kind: 'SERVICE' | 'MARKETING';
  automationKind?: CrmAutomationKind;
  subOrderId?: string;
  campaignId?: string;
  channels?: CrmChannel[];
  scheduledFor?: Date;
  sentAt?: Date;
  status?: 'SCHEDULED' | 'SENT';
}) {
  return prisma.crmMessage.create({
    data: {
      id: ulid(),
      vendorId: data.vendorId,
      userId: data.userId,
      kind: data.kind,
      automationKind: data.automationKind ?? null,
      subOrderId: data.subOrderId ?? null,
      campaignId: data.campaignId ?? null,
      channels: data.channels ?? ['IN_APP', 'EMAIL'],
      status: data.status ?? 'SCHEDULED',
      scheduledFor: data.scheduledFor ?? new Date(Date.now() - 60_000),
      sentAt: data.sentAt ?? null,
    },
  });
}

export const messageRow = (id: string) => prisma.crmMessage.findUniqueOrThrow({ where: { id } });
