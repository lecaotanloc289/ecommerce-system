import type { Money } from '@repo/core';
import { intlLocale, type AppLocale } from './locale';

/** Minor units per major unit. Division happens only here, at the Intl boundary. */
const MINOR_UNITS: Readonly<Record<Money['currency'], number>> = { VND: 1, USD: 100 };

/**
 * Format integer-minor-unit money for display (Golden Rule #2): VND has no fraction digits;
 * USD cents are divided by 100 only when handed to Intl — no float ever feeds back into math.
 * Throws on a non-integer amount instead of displaying a corrupted price.
 */
export function formatMoney(money: Money, locale: AppLocale): string {
  if (!Number.isSafeInteger(money.amount)) {
    throw new Error(`Money amount must be an integer minor unit, got ${money.amount}`);
  }
  const fractionDigits = money.currency === 'VND' ? 0 : 2;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: money.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(money.amount / MINOR_UNITS[money.currency]);
}

/**
 * Format an ISO date-time as a day (e.g. "19 thg 11, 2026" / "Nov 19, 2026").
 * Fixed zone: a static export prerenders in the build TZ and the browser re-renders in the
 * user TZ — a floating zone causes hydration mismatches and day shifts.
 */
export function formatDate(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
}

/**
 * Format an ISO date-time with the time of day (e.g. deadlines in emails), same fixed
 * `Asia/Ho_Chi_Minh` zone as `formatDate`, 24-hour clock.
 */
export function formatDateTime(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
}

/** Compact count for UI badges, e.g. 1200 → "1.2K" (en) / "1,2 N" (vi). */
export function formatCompact(n: number, locale: AppLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
