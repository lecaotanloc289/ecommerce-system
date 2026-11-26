import {
  ConsentAction,
  deriveUnsubscribeToken,
  hashUnsubscribeToken,
  type ConsentSource,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

export type PreferenceRow = Prisma.CustomerVendorPreferenceGetPayload<object>;

/**
 * Returns the (customer, shop) preference row LOCKED (`FOR UPDATE`) for the rest of the
 * transaction, creating it on first use with the deterministic unsubscribe-token hash (C12).
 * Create is `createMany(skipDuplicates)` (no P2002 when two requests create concurrently), then the
 * row is locked and re-read, so every consent decision is made on committed, serialized state.
 * Call inside the transaction that also changes consent so row + events commit together.
 */
export async function ensurePreference(
  tx: Prisma.TransactionClient,
  userId: string,
  vendorId: string,
  secret: string,
): Promise<PreferenceRow> {
  const unsubscribeTokenHash = await hashUnsubscribeToken(
    await deriveUnsubscribeToken(secret, userId, vendorId),
  );
  await tx.customerVendorPreference.createMany({
    data: [{ userId, vendorId, unsubscribeTokenHash }],
    skipDuplicates: true,
  });
  const pref = await lockPreference(tx, userId, vendorId);
  // After a `CRM_UNSUBSCRIBE_SECRET` rotation the stored hash belongs to the old secret: refresh it
  // so links derived with the new one resolve (the worker mirror does the same).
  if (pref.unsubscribeTokenHash === unsubscribeTokenHash) return pref;
  return tx.customerVendorPreference.update({
    where: { userId_vendorId: { userId, vendorId } },
    data: { unsubscribeTokenHash },
  });
}

/** Locks the existing preference row (`FOR UPDATE`) and returns its fresh state. */
export async function lockPreference(
  tx: Prisma.TransactionClient,
  userId: string,
  vendorId: string,
): Promise<PreferenceRow> {
  await tx.$queryRaw`SELECT 1 FROM customer_vendor_preferences WHERE user_id = ${userId} AND vendor_id = ${vendorId} FOR UPDATE`;
  return tx.customerVendorPreference.findUniqueOrThrow({
    where: { userId_vendorId: { userId, vendorId } },
  });
}

/** Marketing consent predicate (packages/db/CLAUDE.md). */
export function hasMarketingConsent(
  pref: Pick<PreferenceRow, 'marketingOptInAt' | 'marketingOptOutAt'>,
): boolean {
  return (
    pref.marketingOptInAt !== null &&
    (pref.marketingOptOutAt === null || pref.marketingOptInAt > pref.marketingOptOutAt)
  );
}

export interface ConsentChange {
  marketingOptIn?: boolean | undefined;
  serviceOptOut?: boolean | undefined;
}

/**
 * Applies the requested consent state to `pref` (timestamps per C5) and appends one append-only
 * `crm_consent_events` row per action that really changed state. Already-in-state requests write
 * nothing. Must run inside a transaction.
 */
export async function applyConsentChange(
  tx: Prisma.TransactionClient,
  pref: PreferenceRow,
  change: ConsentChange,
  source: ConsentSource,
  now: Date,
): Promise<PreferenceRow> {
  const data: Prisma.CustomerVendorPreferenceUpdateInput = {};
  const actions: ConsentAction[] = [];
  const consented = hasMarketingConsent(pref);

  if (change.marketingOptIn === true && !consented) {
    data.marketingOptInAt = now;
    data.marketingOptInSource = source;
    data.marketingOptOutAt = null;
    actions.push(ConsentAction.MARKETING_OPT_IN);
  } else if (change.marketingOptIn === false && consented) {
    data.marketingOptOutAt = now;
    actions.push(ConsentAction.MARKETING_OPT_OUT);
  }

  const serviceOptedOut = pref.serviceOptOutAt !== null;
  if (change.serviceOptOut === true && !serviceOptedOut) {
    data.serviceOptOutAt = now;
    actions.push(ConsentAction.SERVICE_OPT_OUT);
  } else if (change.serviceOptOut === false && serviceOptedOut) {
    data.serviceOptOutAt = null;
    actions.push(ConsentAction.SERVICE_OPT_IN);
  }

  if (actions.length === 0) return pref;
  await tx.crmConsentEvent.createMany({
    data: actions.map((action) => ({
      id: ulid(),
      userId: pref.userId,
      vendorId: pref.vendorId,
      action,
      source,
      createdAt: now,
    })),
  });
  return tx.customerVendorPreference.update({
    where: { userId_vendorId: { userId: pref.userId, vendorId: pref.vendorId } },
    data,
  });
}
