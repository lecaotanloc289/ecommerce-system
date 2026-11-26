import { DomainError, assertCrmCouponCode } from '@repo/core';
import type { Prisma } from '@repo/db';

/**
 * C13: owner-only CRM actions re-check in the DB that the caller holds `VENDOR_OWNER` on THIS
 * vendor (the JWT roles are not per vendor: a user may own one vendor and be staff of another).
 */
export async function assertVendorOwner(
  db: Prisma.TransactionClient,
  userId: string,
  vendorId: string,
): Promise<void> {
  const count = await db.userRole.count({ where: { userId, vendorId, role: 'VENDOR_OWNER' } });
  if (count === 0) throw new DomainError('common.error.forbidden');
}

export async function isVendorOwner(
  db: Prisma.TransactionClient,
  userId: string,
  vendorId: string,
): Promise<boolean> {
  return (await db.userRole.count({ where: { userId, vendorId, role: 'VENDOR_OWNER' } })) > 0;
}

const COUPON_PLACEHOLDER = '{couponCode}';

/**
 * A shop template that uses `{couponCode}` needs an attached coupon, otherwise the placeholder
 * would render empty → `crm.error.unknown-placeholder {placeholder: 'couponCode'}`.
 */
export function assertCouponPlaceholder(
  templates: readonly (string | null)[],
  couponId: string | null,
): void {
  if (couponId !== null) return;
  if (templates.some((t) => t?.includes(COUPON_PLACEHOLDER) === true)) {
    throw new DomainError('crm.error.unknown-placeholder', { placeholder: 'couponCode' });
  }
}

/**
 * A coupon attached to a CRM automation / campaign (C10): the caller vendor's own VENDOR coupon,
 * active, valid at `at` (`startsAt ≤ at < endsAt`) and with a code safe to embed in a message
 * (`assertCrmCouponCode`). Anything else → 422 `crm.error.coupon-invalid`. Returns the code.
 */
export async function assertCrmCoupon(
  db: Prisma.TransactionClient,
  vendorId: string,
  couponId: string,
  at: Date,
): Promise<string> {
  const coupon = await db.coupon.findFirst({
    where: { id: couponId, vendorId, scope: 'VENDOR' },
    select: { code: true, isActive: true, startsAt: true, endsAt: true },
  });
  if (!coupon || !coupon.isActive || coupon.startsAt > at || coupon.endsAt <= at) {
    throw new DomainError('crm.error.coupon-invalid', { couponId });
  }
  assertCrmCouponCode(coupon.code);
  return coupon.code;
}
