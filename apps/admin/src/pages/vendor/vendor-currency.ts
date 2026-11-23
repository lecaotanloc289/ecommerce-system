import type { Currency } from '@repo/core';
import { hasAnyRole, VENDOR_OWNER_ROLES } from '@/auth/roles';
import { useCurrentUser } from '@/auth/session';
import { useVendorWallet } from './wallet-page';

const ALL_CURRENCIES: readonly Currency[] = ['VND', 'USD'];

export interface VendorCurrency {
  /** The shop's selling currency, or `null` when it cannot be read (staff, wallet error). */
  currency: Currency | null;
  isPending: boolean;
}

/**
 * One currency per vendor = its wallet currency: the API refuses products / shipping methods
 * priced in any other (422 `common.error.validation-failed {field: 'currency', expected}`).
 * Owners read it from `GET /v1/vendor/wallet` (cached, shared with the dashboard). Staff cannot
 * read the wallet, so for them it stays `null`: every currency is offered and a wrong pick
 * surfaces as the translated server error naming the expected currency (`errorMessage`).
 */
export function useVendorCurrency(): VendorCurrency {
  const user = useCurrentUser();
  const isOwner = hasAnyRole(user.roles, VENDOR_OWNER_ROLES);
  const wallet = useVendorWallet(isOwner);
  if (!isOwner) return { currency: null, isPending: false };
  return { currency: wallet.data?.balance.currency ?? null, isPending: wallet.isPending };
}

/** Currencies a price picker offers: only the shop currency when known (plus `keep`, an existing value). */
export function currencyOptions(currency: Currency | null, keep?: Currency): readonly Currency[] {
  if (!currency) return ALL_CURRENCIES;
  return keep && keep !== currency ? [currency, keep] : [currency];
}
