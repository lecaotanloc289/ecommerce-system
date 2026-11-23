const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A fresh ULID for an `Idempotency-Key` (48-bit time + 80 random bits, Crockford base32).
 * Create one per user action (a form submit) and reuse it for retries of that action; the
 * SDK would otherwise generate a new key per call. `random` is injectable for tests.
 */
export function newIdempotencyKey(
  now: number = Date.now(),
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = random(new Uint8Array(10));
  // 80 bits → 16 chars of 5 bits.
  let bits = 0;
  let acc = 0;
  let rand = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD.charAt((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  return time + rand;
}
