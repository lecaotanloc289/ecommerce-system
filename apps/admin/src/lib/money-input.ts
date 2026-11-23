import type { Currency, Money } from '@repo/core';

// Parse / format the text a person types into a price field. Money is an integer in the smallest
// unit (Golden Rule #2): the text is split into whole and fraction digits and combined with
// integer arithmetic — never `parseFloat(x) * 100`, which turns 19.99 into 1998.9999999999998.

/** Fraction digits a person may type: VND (đồng) has none, USD has cents. */
const FRACTION_DIGITS: Readonly<Record<Currency, number>> = { VND: 0, USD: 2 };

const WHOLE_WITH_GROUPS = /^\d{1,3}(?:[.,]\d{3})+$/;
const DIGITS = /^\d+$/;

function parseWhole(text: string, currency: Currency): string | null {
  if (DIGITS.test(text)) return text;
  // Grouping is accepted only in its canonical shape (1,234,567 / 1.234.567); USD uses the comma.
  if (WHOLE_WITH_GROUPS.test(text)) {
    const separators = new Set(text.replace(/\d/g, ''));
    if (separators.size !== 1) return null;
    if (currency === 'USD' && !separators.has(',')) return null;
    return text.replace(/[.,]/g, '');
  }
  return null;
}

function fractionToMinor(fraction: string, digits: number): bigint {
  if (digits === 0 || fraction === '') return 0n;
  return BigInt(fraction.padEnd(digits, '0'));
}

/**
 * Text → minor units, or `null` when it is not an exact, non-negative amount in that currency.
 * VND: `150000`, `150.000`, `150,000`. USD: `12`, `12.5`, `12.50`, `1,234.50`; a decimal comma
 * (`12,50`) is read as cents when 1-2 digits follow the last separator. Extra fraction digits are
 * rejected, never rounded.
 */
export function parseMoneyInput(raw: string, currency: Currency): number | null {
  const text = raw.trim().replace(/\s+/g, '');
  if (text === '') return null;

  const fractionDigits = FRACTION_DIGITS[currency];
  let wholeText = text;
  let fractionText = '';

  if (fractionDigits > 0) {
    // `1,234` is thousands, not 1.234 — only 1-2 trailing digits can be a fraction.
    const match = /^(.*?)[.,](\d{1,2})$/.exec(text);
    if (match) {
      wholeText = match[1] ?? '';
      fractionText = match[2] ?? '';
    }
  }

  const whole = wholeText === '' && fractionText !== '' ? '0' : parseWhole(wholeText, currency);
  if (whole === null) return null;

  const minor =
    BigInt(whole) * 10n ** BigInt(fractionDigits) + fractionToMinor(fractionText, fractionDigits);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

/** Minor units → the plain text shown in an editable price field (`150000`, `12.50`). */
export function formatMoneyInput(amount: number, currency: Currency): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return '';
  const digits = FRACTION_DIGITS[currency];
  if (digits === 0) return String(amount);
  const unit = 10 ** digits;
  const whole = Math.trunc(amount / unit);
  const fraction = String(amount % unit).padStart(digits, '0');
  return `${whole}.${fraction}`;
}

/** `{ amount, currency }` from field text, or `null` when invalid. */
export function moneyFromInput(raw: string, currency: Currency): Money | null {
  const amount = parseMoneyInput(raw, currency);
  return amount === null ? null : { amount, currency };
}
