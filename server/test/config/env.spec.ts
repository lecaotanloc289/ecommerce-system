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

  it('defaults rate limits to 100 / 20 requests per minute and validates them', () => {
    expect(testEnv()).toMatchObject({
      RATE_LIMIT_MAX: 100,
      RATE_LIMIT_STRICT_MAX: 20,
      RATE_LIMIT_WINDOW: 60,
      TRUSTED_PROXY_HOPS: 0,
    });
    expect(testEnv({ TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(() => testEnv({ TRUSTED_PROXY_HOPS: '-1' })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(testEnv({ RATE_LIMIT_MAX: '500', RATE_LIMIT_WINDOW: '10s' })).toMatchObject({
      RATE_LIMIT_MAX: 500,
      RATE_LIMIT_WINDOW: 10,
    });
    expect(() => testEnv({ RATE_LIMIT_STRICT_MAX: '0' })).toThrow(/RATE_LIMIT_STRICT_MAX/);
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

  it('requires a 32+ char CRM_UNSUBSCRIBE_SECRET and rejects its placeholder in production', () => {
    expect(() => testEnv({ CRM_UNSUBSCRIBE_SECRET: 'short' })).toThrow(/CRM_UNSUBSCRIBE_SECRET/);
    const placeholder = 'change-me-crm-unsubscribe-32-byte-random';
    expect(() => testEnv({ CRM_UNSUBSCRIBE_SECRET: placeholder })).not.toThrow();
    expect(() => testEnv({ CRM_UNSUBSCRIBE_SECRET: placeholder, NODE_ENV: 'production' })).toThrow(
      /CRM_UNSUBSCRIBE_SECRET/,
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
});
