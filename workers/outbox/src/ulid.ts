import { randomBytes } from 'node:crypto';

// Crockford base32, the ULID alphabet (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Canonical ULID (48-bit ms timestamp + 80 random bits, 26 chars), matching `@repo/core`
 * `ULID_REGEX`. Local because the `ulid` package is not a dependency of this workspace; ordering
 * within the same millisecond is random (not monotonic), which is fine for outbox ids.
 */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let ms = now;
  for (let i = 0; i < 10; i += 1) {
    time = ALPHABET.charAt(ms % 32) + time;
    ms = Math.floor(ms / 32);
  }
  let random = '';
  for (const byte of randomBytes(16)) random += ALPHABET.charAt(byte % 32);
  return time + random;
}
