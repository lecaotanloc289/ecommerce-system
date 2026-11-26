import { createHmac, timingSafeEqual } from 'node:crypto';

// VNPay v2.1.0 signing primitives. Pure functions, exported for tests and for anyone who needs to
// sign/verify a VNPay URL without the full adapter.

const UNRESERVED = /^[A-Za-z0-9.\-*_]$/;

/**
 * Form-urlencodes a value the way VNPay's reference merchants do (Java `URLEncoder.encode`,
 * PHP `urlencode`): unreserved `A-Z a-z 0-9 . - * _` kept, space → `+`, every other byte of the
 * UTF-8 encoding → `%XX` (upper-case hex). The signed string and the URL use the same encoding.
 *
 * NOT `encodeURIComponent`: that keeps `! ' ( ) ~` and writes space as `%20`, which VNPay hashes
 * differently. (Java and PHP differ only on `*`; `sanitizeOrderInfo` keeps our own values clear of it.)
 */
export function vnpEncode(value: string): string {
  let out = '';
  for (const char of value) {
    if (char === ' ') {
      out += '+';
    } else if (UNRESERVED.test(char)) {
      out += char;
    } else {
      for (const byte of Buffer.from(char, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

/**
 * Canonical query string VNPay signs: `vnp_*` params (minus `vnp_SecureHash` and
 * `vnp_SecureHashType`) with a non-empty value, sorted by key (ASCII order), each `key=value`
 * form-urlencoded, joined with `&`. Empty values are skipped, as VNPay's Java reference does.
 * The same string (plus `&vnp_SecureHash=...`) is the payment URL's query.
 */
export function buildSignData(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .filter(
      (key) =>
        key.startsWith('vnp_') &&
        key !== 'vnp_SecureHash' &&
        key !== 'vnp_SecureHashType' &&
        params[key] !== undefined &&
        params[key] !== '',
    )
    .sort()
    .map((key) => `${vnpEncode(key)}=${vnpEncode(params[key] ?? '')}`)
    .join('&');
}

/** HMAC-SHA512 of `data` (UTF-8) keyed with the merchant hash secret, lower-case hex. */
export function hmacSha512(secret: string, data: string): string {
  return createHmac('sha512', secret).update(data, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests (case-insensitive). */
export function safeEqualHex(expected: string, received: string): boolean {
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(received.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;

/** `yyyyMMddHHmmss` in GMT+7 (Vietnam has no DST), as VNPay expects for every date field. */
export function formatVnpDate(date: Date): string {
  const d = new Date(date.getTime() + GMT7_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

const ORDER_INFO_MAX = 255;

/**
 * VNPay wants `vnp_OrderInfo` as "Vietnamese without diacritics, no special characters", max 255.
 * Strips diacritics (đ/Đ → d/D), replaces anything outside `A-Z a-z 0-9 space . - _ :` with a
 * space, collapses whitespace. Keeping to these characters also keeps every encoder variant
 * (Java/PHP/Node) producing the same signed string.
 */
export function sanitizeOrderInfo(text: string, fallback: string): string {
  const cleaned = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 .\-_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ORDER_INFO_MAX)
    .trim();
  return cleaned === '' ? fallback : cleaned;
}
