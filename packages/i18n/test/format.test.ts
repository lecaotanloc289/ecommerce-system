import { describe, expect, it } from 'vitest';
import { formatCompact, formatDate, formatMoney } from '../src/format';
import { fromCoreLocale, intlLocale, isAppLocale, toCoreLocale } from '../src/locale';

// Intl separates number and symbol with NBSP / narrow NBSP; normalise for readable assertions.
const plain = (s: string): string => s.replace(/[  ]/g, ' ');

describe('formatMoney', () => {
  it.each([
    [{ amount: 199_000, currency: 'VND' as const }, 'vi', '199.000 ₫'],
    [{ amount: 199_000, currency: 'VND' as const }, 'en', '₫199,000'],
    [{ amount: 1_999, currency: 'USD' as const }, 'en', '$19.99'],
    [{ amount: 1_999, currency: 'USD' as const }, 'vi', '19,99 US$'],
    [{ amount: 7, currency: 'USD' as const }, 'en', '$0.07'],
    [{ amount: -500, currency: 'USD' as const }, 'en', '-$5.00'],
    [{ amount: 0, currency: 'VND' as const }, 'vi', '0 ₫'],
  ] as const)('%o in %s → %s', (money, locale, expected) => {
    expect(plain(formatMoney(money, locale))).toBe(expected);
  });

  it.each([19.99, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'rejects non-integer amount %s',
    (amount) => {
      expect(() => formatMoney({ amount, currency: 'USD' }, 'en')).toThrow(/integer minor unit/);
    },
  );
});

describe('formatDate', () => {
  it('formats per locale in the fixed Asia/Ho_Chi_Minh zone', () => {
    // 18:30Z is already the 19th in Vietnam (UTC+7).
    expect(formatDate('2026-11-18T18:30:00Z', 'en')).toBe('Nov 19, 2026');
    expect(formatDate('2026-11-18T18:30:00Z', 'vi')).toBe('19 thg 11, 2026');
    expect(formatDate('2026-11-18T16:00:00Z', 'en')).toBe('Nov 18, 2026');
  });
});

describe('formatCompact', () => {
  it('abbreviates per locale', () => {
    expect(formatCompact(1_200, 'en')).toBe('1.2K');
    expect(plain(formatCompact(1_200, 'vi'))).toBe('1,2 N');
  });
});

describe('locale mapping', () => {
  it('maps UI locale ↔ core (Prisma) locale both ways', () => {
    expect(toCoreLocale('vi')).toBe('VI');
    expect(toCoreLocale('en')).toBe('EN');
    expect(fromCoreLocale('VI')).toBe('vi');
    expect(fromCoreLocale(toCoreLocale('en'))).toBe('en');
  });

  it('guards and Intl tags', () => {
    expect(isAppLocale('vi')).toBe(true);
    expect(isAppLocale('VI')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(intlLocale('vi')).toBe('vi-VN');
    expect(intlLocale('en')).toBe('en-US');
  });
});
