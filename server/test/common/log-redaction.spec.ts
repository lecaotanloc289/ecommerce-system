import { redactRequestUrl, redactUrlSecrets } from '../../src/common/log-redaction';

describe('redactUrlSecrets', () => {
  it('redacts the token query value and keeps the rest', () => {
    expect(
      redactUrlSecrets('/v1/crm/unsubscribe/one-click?token=abcDEF123_-xyz&scope=MARKETING'),
    ).toBe('/v1/crm/unsubscribe/one-click?token=%5Bredacted%5D&scope=MARKETING');
  });

  it('leaves URLs without secrets untouched', () => {
    expect(redactUrlSecrets('/v1/products?cursor=01ABC&limit=20')).toBe(
      '/v1/products?cursor=01ABC&limit=20',
    );
    expect(redactUrlSecrets('/v1/health')).toBe('/v1/health');
  });

  it('redactRequestUrl rewrites the serialized request url in place', () => {
    const req = { method: 'POST', url: '/v1/crm/unsubscribe/one-click?token=secret&scope=ALL' };
    expect(redactRequestUrl(req).url).not.toContain('secret');
  });
});
