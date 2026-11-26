import { describe, expect, it, vi } from 'vitest';
import { createApiClient, IDEMPOTENCY_HEADER } from '../src';

const BASE = 'http://api.test';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ME = {
  id: '01J9ZQ4V6N5X8Y7W3T2R1P0M9K',
  email: null,
  name: 'A',
  avatarUrl: null,
  primaryLocale: 'VI',
  roles: ['CUSTOMER'],
  vendorId: null,
};

type Handler = (request: Request) => Response | Promise<Response>;

/** Records every call as the actual Request/URL+init the client sent. */
function recordingFetch(handler: Handler) {
  const calls: Request[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request.clone());
    return handler(request);
  };
  return { calls, fetchImpl };
}

describe('createApiClient', () => {
  it('sends the Bearer token and includes credentials', async () => {
    const { calls, fetchImpl } = recordingFetch(() => json(ME));
    const client = createApiClient({
      baseUrl: BASE,
      getAccessToken: () => 'tok-1',
      fetch: fetchImpl,
    });

    const { data } = await client.GET('/v1/auth/me');

    expect(data?.name).toBe('A');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tok-1');
    expect(calls[0]?.credentials).toBe('include');
    expect(calls[0]?.headers.has(IDEMPOTENCY_HEADER)).toBe(false);
  });

  it('omits Authorization when there is no token', async () => {
    const { calls, fetchImpl } = recordingFetch(() => json(ME));
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => null, fetch: fetchImpl });
    await client.GET('/v1/auth/me');
    expect(calls[0]?.headers.has('Authorization')).toBe(false);
  });

  it('generates a ULID Idempotency-Key for POST and keeps a caller-supplied one', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => 't', fetch: fetchImpl });

    await client.POST('/v1/auth/logout');
    await client.POST('/v1/auth/logout', { headers: { [IDEMPOTENCY_HEADER]: 'mine-123' } });

    expect(calls[0]?.headers.get(IDEMPOTENCY_HEADER)).toMatch(ULID_RE);
    expect(calls[1]?.headers.get(IDEMPOTENCY_HEADER)).toBe('mine-123');
  });

  it('on 401 refreshes once and retries with the new token (same Idempotency-Key)', async () => {
    const onAccessToken = vi.fn();
    const { calls, fetchImpl } = recordingFetch((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/v1/auth/refresh') {
        return json({ accessToken: 'tok-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      return request.headers.get('Authorization') === 'Bearer tok-2'
        ? new Response(null, { status: 204 })
        : json({ errorCode: 'auth.error.token-expired' }, 401);
    });
    const client = createApiClient({
      baseUrl: BASE,
      getAccessToken: () => 'tok-1',
      onAccessToken,
      fetch: fetchImpl,
    });

    const { response } = await client.POST('/v1/auth/logout');

    expect(response.status).toBe(204);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/auth/logout',
      '/v1/auth/refresh',
      '/v1/auth/logout',
    ]);
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.credentials).toBe('include');
    expect(calls[2]?.headers.get('Authorization')).toBe('Bearer tok-2');
    expect(calls[2]?.headers.get(IDEMPOTENCY_HEADER)).toBe(
      calls[0]?.headers.get(IDEMPOTENCY_HEADER),
    );
    expect(onAccessToken).toHaveBeenCalledExactlyOnceWith('tok-2');
  });

  it('shares ONE refresh between concurrent 401s (single-flight)', async () => {
    let refreshes = 0;
    const { fetchImpl } = recordingFetch(async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/v1/auth/refresh') {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json({ accessToken: 'tok-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      return request.headers.get('Authorization') === 'Bearer tok-2'
        ? json(ME)
        : json({ errorCode: 'auth.error.token-expired' }, 401);
    });
    const client = createApiClient({
      baseUrl: BASE,
      getAccessToken: () => 'tok-1',
      fetch: fetchImpl,
    });

    const results = await Promise.all([
      client.GET('/v1/auth/me'),
      client.GET('/v1/auth/me'),
      client.GET('/v1/auth/me'),
    ]);

    expect(refreshes).toBe(1);
    expect(results.every((r) => r.response.status === 200)).toBe(true);
  });

  it('calls onUnauthorized and returns the 401 when the refresh is rejected', async () => {
    const onUnauthorized = vi.fn();
    const { calls, fetchImpl } = recordingFetch(() =>
      json({ errorCode: 'auth.error.token-invalid' }, 401),
    );
    const client = createApiClient({
      baseUrl: BASE,
      getAccessToken: () => 'tok-1',
      onUnauthorized,
      fetch: fetchImpl,
    });

    const { response } = await client.GET('/v1/auth/me');

    expect(response.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2); // original + refresh, no retry, no refresh loop
  });

  it('does not refresh again when the retried request is still 401', async () => {
    let refreshes = 0;
    const { calls, fetchImpl } = recordingFetch((request) => {
      if (new URL(request.url).pathname === '/v1/auth/refresh') {
        refreshes += 1;
        return json({ accessToken: 'tok-2', tokenType: 'Bearer', expiresIn: 900 });
      }
      return json({ errorCode: 'auth.error.token-invalid' }, 401);
    });
    const client = createApiClient({ baseUrl: BASE, getAccessToken: () => 'x', fetch: fetchImpl });

    const { response } = await client.GET('/v1/auth/me');

    expect(response.status).toBe(401);
    expect(refreshes).toBe(1);
    expect(calls).toHaveLength(3);
  });
});
