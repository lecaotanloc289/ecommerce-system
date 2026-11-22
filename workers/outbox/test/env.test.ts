import { describe, expect, it } from 'vitest';
import { parseEnv, streamProviderConfig } from '../src/env.js';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/ecommerce',
  REDIS_URL: 'redis://localhost:6379',
};
const cloudflare = {
  LIVE_STREAM_PROVIDER: 'cloudflare',
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acc123',
  CLOUDFLARE_STREAM_API_TOKEN: 'token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
};

describe('parseEnv', () => {
  it('applies defaults (fake provider, 1 s poll, batch 50)', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LIVE_STREAM_PROVIDER: 'fake',
      OUTBOX_POLL_INTERVAL_MS: 1_000,
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_CONCURRENCY: 5,
    });
    expect(streamProviderConfig(env)).toEqual({ provider: 'fake' });
  });

  it('requires DATABASE_URL and REDIS_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects the fake provider in production (explicit or defaulted)', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', LIVE_STREAM_PROVIDER: 'fake' }),
    ).toThrow(/LIVE_STREAM_PROVIDER: The fake stream provider is not allowed in production/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/LIVE_STREAM_PROVIDER/);
  });

  it('accepts cloudflare in production when every Cloudflare var is set', () => {
    const env = parseEnv({ ...base, ...cloudflare, NODE_ENV: 'production' });
    expect(streamProviderConfig(env)).toEqual({
      provider: 'cloudflare',
      accountId: 'acc123',
      apiToken: 'token',
      customerCode: 'abc123',
    });
  });

  it('requires every Cloudflare var when provider = cloudflare (empty string = unset)', () => {
    let message = '';
    try {
      parseEnv({ ...base, LIVE_STREAM_PROVIDER: 'cloudflare', CLOUDFLARE_STREAM_API_TOKEN: '' });
    } catch (err) {
      message = err instanceof Error ? err.message : '';
    }
    expect(message).toContain('CLOUDFLARE_STREAM_ACCOUNT_ID: Required when');
    expect(message).toContain('CLOUDFLARE_STREAM_API_TOKEN: Required when');
    expect(message).toContain('CLOUDFLARE_STREAM_CUSTOMER_CODE: Required when');
  });

  it('rejects an unknown provider and a non-positive batch size', () => {
    expect(() => parseEnv({ ...base, LIVE_STREAM_PROVIDER: 'mux' })).toThrow(
      /LIVE_STREAM_PROVIDER/,
    );
    expect(() => parseEnv({ ...base, OUTBOX_BATCH_SIZE: '0' })).toThrow(/OUTBOX_BATCH_SIZE/);
  });
});
