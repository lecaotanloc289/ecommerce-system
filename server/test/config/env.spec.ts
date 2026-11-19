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
});
