// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSession } from '@/auth/auth-store';
import { json, makeUser } from './fixtures';

const BASE = 'http://api.test';
const TOKEN = { accessToken: 'access-1', tokenType: 'Bearer', expiresIn: 900 };

type Handler = (request: Request) => Response | Promise<Response>;

/** Fake `fetch` routing by `METHOD /path`; records every call. */
function fakeApi(routes: Record<string, Handler>) {
  const calls: Request[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const handler = routes[route];
    if (!handler) throw new Error(`unexpected ${route}`);
    return Promise.resolve(handler(request));
  });
  const count = (route: string) =>
    calls.filter((r) => `${r.method} ${new URL(r.url).pathname}` === route).length;
  return { fetch: fetchFn, calls, count };
}

describe('restoreSession (boot silent refresh)', () => {
  it('refresh → me → authenticated, token kept in memory', async () => {
    const user = makeUser(['VENDOR_OWNER']);
    const api = fakeApi({
      'POST /v1/auth/refresh': () => json(TOKEN),
      'GET /v1/auth/me': (req) =>
        req.headers.get('Authorization') === 'Bearer access-1'
          ? json(user)
          : json({ errorCode: 'auth.error.token-invalid', params: {} }, 401),
    });
    const { authStore } = createSession({ baseUrl: BASE, fetch: api.fetch });

    expect(authStore.getState().status).toBe('restoring');
    await authStore.getState().restoreSession();

    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'access-1',
      user,
    });
    const refresh = api.calls.find((r) => r.url.endsWith('/v1/auth/refresh'));
    expect(refresh?.credentials).toBe('include'); // the HttpOnly cookie must be sent
  });

  it('is single-flight: concurrent callers share ONE refresh (the server rotates the cookie)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = fakeApi({
      'POST /v1/auth/refresh': async () => {
        await gate;
        return json(TOKEN);
      },
      'GET /v1/auth/me': () => json(makeUser(['PLATFORM_ADMIN'])),
    });
    const { authStore } = createSession({ baseUrl: BASE, fetch: api.fetch });

    const first = authStore.getState().restoreSession();
    const second = authStore.getState().restoreSession(); // e.g. StrictMode / /auth/callback
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);

    expect(api.count('POST /v1/auth/refresh')).toBe(1);
    expect(api.count('GET /v1/auth/me')).toBe(1);
    expect(authStore.getState().status).toBe('authenticated');

    // Once settled, a later call (retry button) starts a new flight.
    await authStore.getState().restoreSession();
    expect(api.count('POST /v1/auth/refresh')).toBe(2);
  });

  it('a rejected refresh (no / revoked cookie) → anonymous, /me never called', async () => {
    const api = fakeApi({
      'POST /v1/auth/refresh': () =>
        json({ errorCode: 'auth.error.refresh-revoked', params: {} }, 401),
    });
    const { authStore } = createSession({ baseUrl: BASE, fetch: api.fetch });

    await authStore.getState().restoreSession();

    expect(authStore.getState()).toMatchObject({
      status: 'anonymous',
      accessToken: null,
      user: null,
    });
    expect(api.count('GET /v1/auth/me')).toBe(0);
  });

  it('a network failure → error (session may still be valid; offer retry)', async () => {
    const api = fakeApi({
      'POST /v1/auth/refresh': () => {
        throw new TypeError('fetch failed');
      },
    });
    const { authStore } = createSession({ baseUrl: BASE, fetch: api.fetch });

    await authStore.getState().restoreSession();

    expect(authStore.getState().status).toBe('error');
  });

  it('a 5xx from refresh → error, not anonymous', async () => {
    const api = fakeApi({
      'POST /v1/auth/refresh': () => json({ errorCode: 'common.error.internal', params: {} }, 503),
    });
    const { authStore } = createSession({ baseUrl: BASE, fetch: api.fetch });

    await authStore.getState().restoreSession();

    expect(authStore.getState().status).toBe('error');
  });
});

describe('API client wiring', () => {
  it('stores the token from an automatic 401 → refresh retry', async () => {
    const api = fakeApi({
      'POST /v1/auth/refresh': () => json(TOKEN),
      'GET /v1/auth/me': (req) =>
        req.headers.get('Authorization') === 'Bearer access-1'
          ? json(makeUser(['VENDOR_STAFF']))
          : json({ errorCode: 'auth.error.token-expired', params: {} }, 401),
    });
    const session = createSession({ baseUrl: BASE, fetch: api.fetch });
    session.authStore.setState({ status: 'authenticated', accessToken: 'stale' });

    const { response } = await session.api.GET('/v1/auth/me');

    expect(response.status).toBe(200);
    expect(session.authStore.getState().accessToken).toBe('access-1');
    expect(api.count('POST /v1/auth/refresh')).toBe(1);
  });

  it('ends the session when the SDK refresh is rejected', async () => {
    const api = fakeApi({
      'GET /v1/auth/me': () => json({ errorCode: 'auth.error.token-expired', params: {} }, 401),
      'POST /v1/auth/refresh': () =>
        json({ errorCode: 'auth.error.refresh-revoked', params: {} }, 401),
    });
    const session = createSession({ baseUrl: BASE, fetch: api.fetch });
    session.authStore.setState({
      status: 'authenticated',
      accessToken: 'stale',
      user: makeUser(['VENDOR_OWNER']),
    });

    await session.api.GET('/v1/auth/me');

    expect(session.authStore.getState()).toMatchObject({
      status: 'anonymous',
      user: null,
      accessToken: null,
    });
  });
});

describe('signOut', () => {
  it('calls logout with credentials and forgets the in-memory session', async () => {
    const api = fakeApi({ 'POST /v1/auth/logout': () => new Response(null, { status: 204 }) });
    const session = createSession({ baseUrl: BASE, fetch: api.fetch });
    session.authStore.setState({
      status: 'authenticated',
      accessToken: 'tok',
      user: makeUser(['VENDOR_OWNER']),
    });

    await session.authStore.getState().signOut();

    expect(api.calls[0]?.credentials).toBe('include');
    expect(session.authStore.getState()).toMatchObject({
      status: 'anonymous',
      accessToken: null,
      user: null,
    });
  });

  it('still signs out locally when the API is unreachable', async () => {
    const api = fakeApi({
      'POST /v1/auth/logout': () => {
        throw new TypeError('offline');
      },
    });
    const session = createSession({ baseUrl: BASE, fetch: api.fetch });
    session.authStore.setState({ status: 'authenticated', accessToken: 'tok' });

    await session.authStore.getState().signOut();

    expect(session.authStore.getState().status).toBe('anonymous');
  });
});
