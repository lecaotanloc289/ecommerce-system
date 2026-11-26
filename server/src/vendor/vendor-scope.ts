import { type Currency, DomainError } from '@repo/core';
import type { Prisma } from '@repo/db';
import type { AuthUser } from '../auth/auth.schemas';

/**
 * The vendor a request acts for. ONLY ever taken from `req.user` (Golden Rule #6) — a staff
 * member without an ACTIVE vendor role has no `vendorId` in the JWT and is rejected.
 */
export function requireVendorId(user: AuthUser): string {
  if (!user.vendorId) throw new DomainError('vendor.error.not-active');
  return user.vendorId;
}

/**
 * Re-checks `Vendor.status = ACTIVE` in the database inside the write transaction (the JWT may be
 * stale). `FOR SHARE` makes a concurrent suspension wait for this transaction, so a suspended
 * vendor cannot slip a write past the check.
 */
export async function assertVendorActive(
  tx: Prisma.TransactionClient,
  vendorId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM vendors WHERE id = ${vendorId} FOR SHARE`;
  const status = rows[0]?.status;
  if (status === undefined) throw new DomainError('vendor.error.not-found');
  if (status === 'SUSPENDED') throw new DomainError('vendor.error.suspended');
  if (status !== 'ACTIVE') throw new DomainError('vendor.error.not-active');
}

/** Currencies the platform sells in (`PlatformSettings.supportedCurrencies`, default VND). */
export async function supportedCurrencies(tx: Prisma.TransactionClient): Promise<Currency[]> {
  const settings = await tx.platformSettings.findFirst({
    select: { supportedCurrencies: true },
  });
  return settings?.supportedCurrencies ?? ['VND'];
}

export function assertCurrencySupported(
  supported: readonly Currency[],
  currency: Currency,
  field: string,
): void {
  if (!supported.includes(currency)) {
    throw new DomainError('common.error.validation-failed', { field, currency });
  }
}

/**
 * One currency per vendor = its `Wallet.balanceCurrency` (set to `PlatformSettings.defaultCurrency`
 * at approval). Payouts credit that single wallet, so a product or shipping method priced in any
 * other currency could sell but never be paid out (`release-payouts` skips the sub-order) — refuse
 * it up front with 422 `common.error.validation-failed {field: 'currency'}`.
 */
export async function assertWalletCurrency(
  tx: Prisma.TransactionClient,
  vendorId: string,
  currency: Currency,
): Promise<void> {
  const wallet = await tx.wallet.findUnique({
    where: { vendorId },
    select: { balanceCurrency: true },
  });
  if (!wallet) throw new DomainError('common.error.internal', { reason: 'vendor wallet missing' });
  if (wallet.balanceCurrency !== currency) {
    throw new DomainError('common.error.validation-failed', {
      field: 'currency',
      currency,
      expected: wallet.balanceCurrency,
    });
  }
}

/** True for a Prisma unique-constraint violation (`P2002`), without importing the runtime class. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
