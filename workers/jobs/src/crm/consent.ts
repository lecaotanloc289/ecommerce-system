import { assertCrmCouponCode, deriveUnsubscribeToken, hashUnsubscribeToken } from '@repo/core';
import type { Prisma } from '@repo/db';
import type { Tx } from '../outbox/handler';

export type PreferenceRow = Prisma.CustomerVendorPreferenceGetPayload<object>;

/**
 * Mirror of the API's `ensurePreference` (server `src/crm-consent/consent.service.ts` — the worker
 * cannot import `server/`): returns the (customer, shop) preference row LOCKED `FOR UPDATE` for the
 * rest of the transaction, creating it on first use with the deterministic unsubscribe-token hash
 * (C12) so the links in the email resolve. Same lock as every consent writer, so a send decision
 * and a concurrent opt-out / unsubscribe serialise; it also serialises two sends to the same
 * customer of the same shop (frequency cap, C11). A hash from an older secret is refreshed.
 */
export async function ensurePreference(
  tx: Tx,
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
  await tx.$queryRaw`SELECT 1 FROM customer_vendor_preferences WHERE user_id = ${userId} AND vendor_id = ${vendorId} FOR UPDATE`;
  const pref = await tx.customerVendorPreference.findUniqueOrThrow({
    where: { userId_vendorId: { userId, vendorId } },
  });
  // After a secret rotation the stored hash belongs to the old secret: refresh it, or the links in
  // every email sent from now on would 404 (old links stay void — that is the point of rotating).
  if (pref.unsubscribeTokenHash === unsubscribeTokenHash) return pref;
  return tx.customerVendorPreference.update({
    where: { userId_vendorId: { userId, vendorId } },
    data: { unsubscribeTokenHash },
  });
}

/** Marketing consent predicate (C5, packages/db/CLAUDE.md). */
export function hasMarketingConsent(
  pref: Pick<PreferenceRow, 'marketingOptInAt' | 'marketingOptOutAt'>,
): boolean {
  return (
    pref.marketingOptInAt !== null &&
    (pref.marketingOptOutAt === null || pref.marketingOptInAt > pref.marketingOptOutAt)
  );
}

/**
 * Code of the coupon if it is still usable for CRM at `at` (C10, same rule as the API's
 * `assertCrmCoupon`): the shop's own VENDOR coupon, active, `startsAt ≤ at < endsAt`, code matching
 * the CRM code format. Otherwise null.
 */
export async function validCrmCouponCode(
  tx: Tx,
  vendorId: string,
  couponId: string,
  at: Date,
): Promise<string | null> {
  const coupon = await tx.coupon.findFirst({
    where: { id: couponId, vendorId, scope: 'VENDOR' },
    select: { code: true, isActive: true, startsAt: true, endsAt: true },
  });
  if (!coupon || !coupon.isActive || coupon.startsAt > at || coupon.endsAt <= at) return null;
  try {
    assertCrmCouponCode(coupon.code);
  } catch {
    return null;
  }
  return coupon.code;
}
