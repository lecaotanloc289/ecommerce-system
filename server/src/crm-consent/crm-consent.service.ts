import { Inject, Injectable } from '@nestjs/common';
import {
  ConsentSource,
  DomainError,
  VendorPreferenceSchema,
  hashUnsubscribeToken,
  type Unsubscribe,
  type UpdateVendorPreference,
  type VendorPreference,
} from '@repo/core';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyConsentChange,
  ensurePreference,
  hasMarketingConsent,
  lockPreference,
  type PreferenceRow,
} from './consent.service';

/** C1: sub-order statuses that make someone a customer of the shop. */
const VALID_ORDER_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'] as const;

function toVendorPreference(
  vendorId: string,
  vendorName: string,
  pref: PreferenceRow | undefined,
  fallbackUpdatedAt: Date,
): VendorPreference {
  return VendorPreferenceSchema.parse({
    vendorId,
    vendorName,
    marketingOptIn: pref ? hasMarketingConsent(pref) : false,
    serviceOptOut: pref ? pref.serviceOptOutAt !== null : false,
    updatedAt: (pref?.updatedAt ?? fallbackUpdatedAt).toISOString(),
  });
}

/** A customer's per-shop CRM consent, and the public unsubscribe link handler. */
@Injectable()
export class CrmConsentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Shops the user bought from (valid order) or already has a preference with. */
  async list(userId: string): Promise<VendorPreference[]> {
    const db = this.prisma.client;
    const [bought, prefs] = await Promise.all([
      db.subOrder.groupBy({
        by: ['vendorId'],
        where: { status: { in: [...VALID_ORDER_STATUSES] }, order: { customerId: userId } },
        _max: { createdAt: true },
      }),
      db.customerVendorPreference.findMany({ where: { userId } }),
    ]);
    const prefByVendor = new Map(prefs.map((p) => [p.vendorId, p]));
    const lastOrder = new Map(bought.map((b) => [b.vendorId, b._max.createdAt]));
    const vendorIds = [...new Set([...lastOrder.keys(), ...prefByVendor.keys()])];
    if (vendorIds.length === 0) return [];
    const vendors = await db.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    });
    return vendors.map((v) =>
      toVendorPreference(
        v.id,
        v.displayName,
        prefByVendor.get(v.id),
        lastOrder.get(v.id) ?? new Date(),
      ),
    );
  }

  /** Customer-initiated consent change (source STOREFRONT), one transaction. */
  async update(
    userId: string,
    vendorId: string,
    change: UpdateVendorPreference,
  ): Promise<VendorPreference> {
    const db = this.prisma.client;
    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: { displayName: true },
    });
    if (!vendor) throw new DomainError('vendor.error.not-found');
    return db.$transaction(async (tx) => {
      const existing = await tx.customerVendorPreference.findUnique({
        where: { userId_vendorId: { userId, vendorId } },
        select: { userId: true },
      });
      const bought =
        existing !== null ||
        (await tx.subOrder.count({
          where: {
            vendorId,
            status: { in: [...VALID_ORDER_STATUSES] },
            order: { customerId: userId },
          },
        })) > 0;
      if (!bought) throw new DomainError('vendor.error.not-found');
      const pref = await ensurePreference(tx, userId, vendorId, this.env.CRM_UNSUBSCRIBE_SECRET);
      const now = new Date();
      const updated = await applyConsentChange(tx, pref, change, ConsentSource.STOREFRONT, now);
      return toVendorPreference(vendorId, vendor.displayName, updated, now);
    });
  }

  /** Public unsubscribe by token (source UNSUBSCRIBE_LINK). Idempotent. */
  async unsubscribe(input: Unsubscribe): Promise<void> {
    const tokenHash = await hashUnsubscribeToken(input.token);
    await this.prisma.client.$transaction(async (tx) => {
      const found = await tx.customerVendorPreference.findUnique({
        where: { unsubscribeTokenHash: tokenHash },
        select: { userId: true, vendorId: true },
      });
      if (!found) throw new DomainError('crm.error.unsubscribe-invalid');
      // Lock + re-read: a concurrent opt-in/unsubscribe is serialized, the last writer wins.
      const pref = await lockPreference(tx, found.userId, found.vendorId);
      await applyConsentChange(
        tx,
        pref,
        input.scope === 'ALL'
          ? { marketingOptIn: false, serviceOptOut: true }
          : { marketingOptIn: false },
        ConsentSource.UNSUBSCRIBE_LINK,
        new Date(),
      );
    });
  }
}
