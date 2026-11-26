import { createHash } from 'node:crypto';

/** Recursively sorts object keys so `{a,b}` and `{b,a}` serialize identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** Canonical JSON: stable key order, so equal payloads always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value ?? null));
}

/**
 * sha256 over method + concrete URL (path incl. params and query) + canonical JSON body. Using the
 * concrete URL, not the route pattern, means one key replayed against `/orders/A/cancel` and
 * `/orders/B/cancel` is a key reuse, never a replay of A's response for B.
 */
export function fingerprintRequest(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()}\n${url}\n${canonicalJson(body)}`)
    .digest('hex');
}
