import { canonicalJson, fingerprintRequest } from '../../src/common/idempotency/fingerprint';

describe('canonicalJson', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 0 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":0,"z":1}]},"b":1}',
    );
  });

  it('encodes a missing body as null', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('fingerprintRequest', () => {
  const body = { items: [{ sku: 'A', qty: 1 }], note: 'x' };

  it('is stable across key order and method case', () => {
    expect(fingerprintRequest('post', '/v1/orders', body)).toBe(
      fingerprintRequest('POST', '/v1/orders', { note: 'x', items: [{ qty: 1, sku: 'A' }] }),
    );
  });

  it.each([
    ['method', 'PUT', '/v1/orders', body],
    ['url', 'POST', '/v1/orders?dry=1', body],
    ['body', 'POST', '/v1/orders', { ...body, note: 'y' }],
    ['array order', 'POST', '/v1/orders', { ...body, items: [...body.items, { sku: 'B' }] }],
  ])('changes with the %s', (_label, method, url, other) => {
    expect(fingerprintRequest(method, url, other)).not.toBe(
      fingerprintRequest('POST', '/v1/orders', body),
    );
  });
});
