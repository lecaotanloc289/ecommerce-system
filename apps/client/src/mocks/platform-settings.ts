import type { Currency, Money } from '../types';

/**
 * Mock of the `PlatformSettings` singleton (root CLAUDE.md §9 — tunables live in
 * the DB). Read from the API once `@repo/sdk` exists.
 */
export const platformSettings: {
  defaultCurrency: Currency;
  freeShippingThreshold: Money;
} = {
  defaultCurrency: 'VND',
  freeShippingThreshold: { amount: 1_000_000, currency: 'VND' },
};
