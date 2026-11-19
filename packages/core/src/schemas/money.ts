import { z } from 'zod';
import { CurrencySchema } from '../enums';

/**
 * Money (Golden Rule #2): integer amount in the currency's smallest unit
 * (VND = đồng, USD = cent) + currency. Zod's `.int()` also bounds it to the safe-integer range.
 * Signed — refunds and ledger adjustments are negative. Use NonNegativeMoneySchema for prices.
 */
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const NonNegativeMoneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: CurrencySchema,
});
export type NonNegativeMoney = z.infer<typeof NonNegativeMoneySchema>;
