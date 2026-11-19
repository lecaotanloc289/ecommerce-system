import type { Locale, Money } from '../types';

/**
 * Format integer-minor-unit money for display. No float math (Golden Rule #2):
 * VND has 0 fraction digits; USD divides cents by 100 only at the Intl boundary.
 */
export function formatMoney(money: Money, locale: Locale): string {
  if (!Number.isInteger(money.amount)) {
    throw new Error(`Money amount must be an integer minor unit, got ${money.amount}`);
  }
  const intlLocale = locale === 'vi' ? 'vi-VN' : 'en-US';
  if (money.currency === 'VND') {
    return new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(money.amount);
  }
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: 'USD',
  }).format(money.amount / 100);
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    // Fixed zone: static export prerenders in the build TZ, the browser re-renders in
    // the user TZ — a floating zone causes hydration mismatches and day shifts.
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
}

/** Compact count for UI badges, e.g. 1200 → "1.2K" (en) / "1,2 N" (vi). */
export function formatCompact(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/** Sum money lines of the same currency. Throws on currency mismatch. */
export function sumMoney(lines: Money[], currency: Money['currency']): Money {
  const amount = lines.reduce((acc, m) => {
    if (m.currency !== currency) {
      throw new Error(`Currency mismatch: expected ${currency}, got ${m.currency}`);
    }
    return acc + m.amount;
  }, 0);
  return { amount, currency };
}
