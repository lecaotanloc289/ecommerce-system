import type { Locale as CoreLocale } from '@repo/core';

/**
 * UI locale: lowercase BCP 47 language tags — what `<html lang>`, URLs, localStorage and
 * next-intl use. @repo/core's `Locale` ('VI' | 'EN') mirrors the Prisma enum and is the
 * persisted form (e.g. `User.primaryLocale`). Convert only at that boundary with
 * `toCoreLocale` / `fromCoreLocale`; everything UI-side uses `AppLocale`.
 */
export const APP_LOCALES = ['vi', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'vi';

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'vi' || value === 'en';
}

const TO_CORE: Readonly<Record<AppLocale, CoreLocale>> = { vi: 'VI', en: 'EN' };
const FROM_CORE: Readonly<Record<CoreLocale, AppLocale>> = { VI: 'vi', EN: 'en' };

export function toCoreLocale(locale: AppLocale): CoreLocale {
  return TO_CORE[locale];
}

export function fromCoreLocale(locale: CoreLocale): AppLocale {
  return FROM_CORE[locale];
}

/** Locale tag passed to `Intl.*` formatters. */
export function intlLocale(locale: AppLocale): string {
  return locale === 'vi' ? 'vi-VN' : 'en-US';
}
