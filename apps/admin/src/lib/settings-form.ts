import type { Currency, PlatformSettings, PlatformSettingsUpdate } from '@repo/core';
import { bpsToPercent, percentToBps } from './bps';

/** Mirrors `PlatformSettingsUpdateSchema` in `@repo/core` (the server re-validates). */
export const SETTINGS_BOUNDS = {
  holdPeriodDays: { min: 0, max: 365 },
  refundWindowDays: { min: 0, max: 365 },
  paymentTimeoutMinutes: { min: 5, max: 1440 },
  maxCouponStack: { min: 1, max: 10 },
} as const;

export type IntegerField = keyof typeof SETTINGS_BOUNDS;

export interface SettingsFormValues {
  /** Percent text, e.g. "2.5" (stored as basis points). */
  commission: string;
  holdPeriodDays: string;
  refundWindowDays: string;
  paymentTimeoutMinutes: string;
  maxCouponStack: string;
  supportedCurrencies: Currency[];
  defaultCurrency: Currency;
}

export type SettingsFieldError =
  | { kind: 'percentInvalid' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'currenciesRequired' }
  | { kind: 'defaultNotSupported' };

export type SettingsFormErrors = Partial<Record<keyof SettingsFormValues, SettingsFieldError>>;

export function settingsToForm(
  settings: Omit<PlatformSettings, 'id' | 'updatedAt'>,
): SettingsFormValues {
  return {
    commission: bpsToPercent(settings.commissionBps),
    holdPeriodDays: String(settings.holdPeriodDays),
    refundWindowDays: String(settings.refundWindowDays),
    paymentTimeoutMinutes: String(settings.paymentTimeoutMinutes),
    maxCouponStack: String(settings.maxCouponStack),
    supportedCurrencies: [...settings.supportedCurrencies],
    defaultCurrency: settings.defaultCurrency,
  };
}

function parseInteger(text: string, field: IntegerField): number | SettingsFieldError {
  const { min, max } = SETTINGS_BOUNDS[field];
  const trimmed = text.trim();
  const value = /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
  return value !== null && value >= min && value <= max ? value : { kind: 'range', min, max };
}

export type SettingsValidation =
  | { ok: true; update: PlatformSettingsUpdate }
  | { ok: false; errors: SettingsFormErrors };

/** Client-side validation with the server's bounds; `ok` yields the `PATCH /platform/settings` body. */
export function validateSettingsForm(values: SettingsFormValues): SettingsValidation {
  const errors: SettingsFormErrors = {};

  const commissionBps = percentToBps(values.commission);
  if (commissionBps === null) errors.commission = { kind: 'percentInvalid' };

  const integers: Partial<Record<IntegerField, number>> = {};
  for (const field of Object.keys(SETTINGS_BOUNDS) as IntegerField[]) {
    const parsed = parseInteger(values[field], field);
    if (typeof parsed === 'number') integers[field] = parsed;
    else errors[field] = parsed;
  }

  if (values.supportedCurrencies.length === 0) {
    errors.supportedCurrencies = { kind: 'currenciesRequired' };
  } else if (!values.supportedCurrencies.includes(values.defaultCurrency)) {
    errors.defaultCurrency = { kind: 'defaultNotSupported' };
  }

  if (Object.keys(errors).length > 0 || commissionBps === null) return { ok: false, errors };
  return {
    ok: true,
    update: {
      commissionBps,
      ...integers,
      supportedCurrencies: values.supportedCurrencies,
      defaultCurrency: values.defaultCurrency,
    },
  };
}
