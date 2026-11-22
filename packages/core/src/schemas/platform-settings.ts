import { z } from 'zod';
import { CurrencySchema } from '../enums';
import { PlatformSettingsIdSchema } from '../ids';
import { IsoDateTimeSchema } from './datetime';

const MAX_BPS = 10_000;
const MAX_DAYS = 365;
const MAX_PAYMENT_TIMEOUT_MINUTES = 24 * 60;
const MAX_COUPON_STACK = 10;

const currenciesSchema = z
  .array(CurrencySchema)
  .min(1)
  .refine((v) => new Set(v).size === v.length, 'Duplicate currency');

/** Settings any client may read (`GET /v1/settings`): what the storefront needs to render. */
export const PlatformSettingsPublicSchema = z.object({
  supportedCurrencies: z.array(CurrencySchema).min(1),
  defaultCurrency: CurrencySchema,
  maxCouponStack: z.number().int().min(1),
});
export type PlatformSettingsPublic = z.infer<typeof PlatformSettingsPublicSchema>;

/** Full settings row for platform admin (`GET /v1/platform/settings`). `commissionBps` is basis points. */
export const PlatformSettingsSchema = z.object({
  id: PlatformSettingsIdSchema,
  commissionBps: z.number().int().min(0).max(MAX_BPS),
  holdPeriodDays: z.number().int().min(0),
  refundWindowDays: z.number().int().min(0),
  maxCouponStack: z.number().int().min(1),
  paymentTimeoutMinutes: z.number().int().min(1),
  supportedCurrencies: z.array(CurrencySchema).min(1),
  defaultCurrency: CurrencySchema,
  updatedAt: IsoDateTimeSchema,
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;

/** Body of `PATCH /v1/platform/settings` (admin only): any subset of the tunables. */
export const PlatformSettingsUpdateSchema = z
  .object({
    commissionBps: z.number().int().min(0).max(MAX_BPS),
    holdPeriodDays: z.number().int().min(0).max(MAX_DAYS),
    refundWindowDays: z.number().int().min(0).max(MAX_DAYS),
    maxCouponStack: z.number().int().min(1).max(MAX_COUPON_STACK),
    paymentTimeoutMinutes: z.number().int().min(5).max(MAX_PAYMENT_TIMEOUT_MINUTES),
    supportedCurrencies: currenciesSchema,
    defaultCurrency: CurrencySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')
  .refine(
    (v) =>
      v.supportedCurrencies === undefined ||
      v.defaultCurrency === undefined ||
      v.supportedCurrencies.includes(v.defaultCurrency),
    { message: 'defaultCurrency must be a supported currency', path: ['defaultCurrency'] },
  );
export type PlatformSettingsUpdate = z.infer<typeof PlatformSettingsUpdateSchema>;
