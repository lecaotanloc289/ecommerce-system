const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID (26 chars, Crockford base32: 48-bit millisecond time + 80 random bits) — the format
 * of the API's `Idempotency-Key`. Small and dependency-free; `now` / `random` are injectable
 * for tests.
 */
export function newUlid(
  now: number = Date.now(),
  random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  let time = '';
  let rest = Math.max(0, Math.floor(now));
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = random(new Uint8Array(16));
  let entropy = '';
  for (const byte of bytes) entropy += CROCKFORD.charAt(byte % 32);
  return time + entropy.slice(0, 16);
}
