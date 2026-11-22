import { testEnv } from '../helpers';

describe('parseEnv', () => {
  it('parses a valid environment with Golden Rule #5 TTL defaults', () => {
    const env = testEnv();
    expect(env.JWT_ACCESS_TTL).toBe(15 * 60);
    expect(env.JWT_REFRESH_TTL).toBe(30 * 86_400);
    expect(env.PORT).toBe(3001);
  });

  it('parses durations', () => {
    expect(testEnv({ JWT_ACCESS_TTL: '90s', JWT_REFRESH_TTL: '12h' })).toMatchObject({
      JWT_ACCESS_TTL: 90,
      JWT_REFRESH_TTL: 12 * 3600,
    });
    expect(() => testEnv({ JWT_ACCESS_TTL: '15 minutes' })).toThrow(/JWT_ACCESS_TTL/);
  });

  it('treats empty values as missing and lists every bad key', () => {
    expect(() => testEnv({ GOOGLE_OAUTH_CLIENT_ID: '', REDIS_URL: 'nope' })).toThrow(
      /GOOGLE_OAUTH_CLIENT_ID[\s\S]*REDIS_URL|REDIS_URL[\s\S]*GOOGLE_OAUTH_CLIENT_ID/,
    );
  });

  it('rejects short or identical JWT secrets', () => {
    expect(() => testEnv({ JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    const same = 'x'.repeat(40);
    expect(() => testEnv({ JWT_ACCESS_SECRET: same, JWT_REFRESH_SECRET: same })).toThrow(
      /must differ/,
    );
  });

  it('rejects placeholder secrets in production only', () => {
    const placeholders = {
      JWT_ACCESS_SECRET: 'change-me-access-32-byte-random-base64',
      JWT_REFRESH_SECRET: 'change-me-refresh-32-byte-random-base64',
    };
    expect(() => testEnv(placeholders)).not.toThrow();
    expect(() => testEnv({ ...placeholders, NODE_ENV: 'production' })).toThrow(/Placeholder/);
  });

  describe('live streaming', () => {
    const cloudflare = {
      LIVE_STREAM_PROVIDER: 'cloudflare',
      CLOUDFLARE_STREAM_ACCOUNT_ID: 'account',
      CLOUDFLARE_STREAM_API_TOKEN: 'token',
      CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
      CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'stream-secret',
      CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET: 'notifications-secret',
    };

    it('defaults to the fake provider outside production', () => {
      expect(testEnv().LIVE_STREAM_PROVIDER).toBe('fake');
    });

    it('accepts a complete cloudflare configuration', () => {
      expect(testEnv(cloudflare)).toMatchObject(cloudflare);
    });

    it('requires every Cloudflare var when the provider is cloudflare', () => {
      const { CLOUDFLARE_STREAM_API_TOKEN: _token, ...rest } = cloudflare;
      expect(() => testEnv({ ...rest, CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET: '' })).toThrow(
        /CLOUDFLARE_STREAM_API_TOKEN[\s\S]*CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET/,
      );
    });

    it('rejects the fake provider in production, explicit or by default', () => {
      expect(() => testEnv({ NODE_ENV: 'production', LIVE_STREAM_PROVIDER: 'fake' })).toThrow(
        /LIVE_STREAM_PROVIDER/,
      );
      expect(() => testEnv({ NODE_ENV: 'production' })).toThrow(/LIVE_STREAM_PROVIDER/);
      expect(() => testEnv({ NODE_ENV: 'production', ...cloudflare })).not.toThrow();
    });

    it('rejects an unknown provider', () => {
      expect(() => testEnv({ LIVE_STREAM_PROVIDER: 'mux' })).toThrow(/LIVE_STREAM_PROVIDER/);
    });
  });
});
