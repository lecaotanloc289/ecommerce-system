import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialsCipher } from '../src/credentials.js';
import { parseEnv } from '../src/env.js';
import { normalizeVnPhone } from '../src/messages.js';
import { fakeCredentials } from './fake-gateway.js';

const key = randomBytes(32).toString('base64');

describe('CredentialsCipher', () => {
  it('round-trips and never stores plaintext', () => {
    const cipher = new CredentialsCipher(key);
    const creds = fakeCredentials('x');
    const ciphertext = cipher.encrypt(creds, 'vendor-1');
    expect(ciphertext).not.toContain('cookie-x');
    expect(ciphertext.startsWith('v1.')).toBe(true);
    expect(cipher.decrypt(ciphertext, 'vendor-1')).toEqual(creds);
    expect(cipher.encrypt(creds, 'vendor-1')).not.toBe(ciphertext); // random IV
  });

  it('rejects a wrong key, another vendor and tampered data', () => {
    const ciphertext = new CredentialsCipher(key).encrypt(fakeCredentials(), 'vendor-1');
    expect(() =>
      new CredentialsCipher(randomBytes(32).toString('base64')).decrypt(ciphertext, 'vendor-1'),
    ).toThrow();
    expect(() => new CredentialsCipher(key).decrypt(ciphertext, 'vendor-2')).toThrow();
    const parts = ciphertext.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => new CredentialsCipher(key).decrypt(parts.join('.'), 'vendor-1')).toThrow();
    expect(() => new CredentialsCipher(key).decrypt('garbage', 'vendor-1')).toThrow('Unrecognised');
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new CredentialsCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('normalizeVnPhone', () => {
  it.each([
    ['0901 234 567', '0901234567'],
    ['+84 901-234-567', '0901234567'],
    ['84901234567', '0901234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeVnPhone(input)).toBe(expected);
  });

  it.each(['+1 415 555 0100', '090123', '12345678901'])('%s → null', (input) => {
    expect(normalizeVnPhone(input)).toBeNull();
  });
});

describe('parseEnv', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db', REDIS_URL: 'redis://localhost:6379' };

  it('applies defaults', () => {
    const env = parseEnv({ ...base, ZALO_CREDENTIALS_KEY: key });
    expect(env.ZALO_SEND_MIN_INTERVAL_MS).toBe(3_000);
    expect(env.ZALO_MAX_SEND_ATTEMPTS).toBe(5);
  });

  it('lists every invalid key', () => {
    expect(() => parseEnv({ REDIS_URL: 'nope', ZALO_CREDENTIALS_KEY: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*ZALO_CREDENTIALS_KEY/,
    );
  });
});
