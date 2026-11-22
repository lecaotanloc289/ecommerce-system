import { describe, expect, it, vi } from 'vitest';
import { createAuthStore } from '../src/store/auth-store';

const BASE = 'http://api.test';
const ME = {
  id: '01JD0000000000000000000001',
  email: 'a@example.com',
  name: 'Ana',
  avatarUrl: null,
  primaryLocale: 'VI',
  roles: ['CUSTOMER'],
  vendorId: null,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (status: number, errorCode: string) => json(status, { errorCode, params: {} });

interface Seen {
  method: string;
  path: string;
  auth: string | null;
}

/**
 * Fake API. `POST /v1/auth/refresh` hands out `refreshTokens` in order (exhausted → 401);
 * `GET /v1/auth/me` accepts only tokens currently in `validTokens` (mutable, to expire one).
 * `holdRefresh` parks refresh calls until `release()`.
 */
function fakeApi(opts: { refreshTokens: string[]; validTokens: string[]; holdRefresh?: boolean }) {
  const seen: Seen[] = [];
  const refreshes = [...opts.refreshTokens];
  const parked: (() => void)[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const path = new URL(req.url).pathname;
    seen.push({ method: req.method, path, auth: req.headers.get('authorization') });
    if (path === '/v1/auth/refresh') {
      if (opts.holdRefresh) await new Promise<void>((resolve) => parked.push(resolve));
      const token = refreshes.shift();
      return token
        ? json(200, { accessToken: token, tokenType: 'Bearer', expiresIn: 900 })
        : error(401, 'auth.error.refresh-revoked');
    }
    if (path === '/v1/auth/me') {
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      return opts.validTokens.includes(token)
        ? json(200, ME)
        : error(401, 'auth.error.token-expired');
    }
    if (path === '/v1/auth/logout') return new Response(null, { status: 204 });
    return error(404, 'common.error.not-found');
  };
  return {
    seen,
    fetch: fetchImpl,
    release: () => parked.splice(0).forEach((resolve) => resolve()),
    count: (path: string) => seen.filter((s) => s.path === path).length,
  };
}

describe('auth store', () => {
  it('restores the session with ONE refresh when restore() is called concurrently (mount + StrictMode + callback)', async () => {
    const api = fakeApi({ refreshTokens: ['t1', 't2'], validTokens: ['t1'] });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    expect(store.getState().status).toBe('loading');

    const [a, b, c] = await Promise.all([store.restore(), store.restore(), store.restore()]);

    expect(api.count('/v1/auth/refresh')).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(store.getState()).toEqual({ status: 'authenticated', user: ME });
    expect(api.seen.find((s) => s.path === '/v1/auth/me')?.auth).toBe('Bearer t1');
    expect(await store.getAccessToken()).toBe('t1');
  });

  it('makes API calls issued during the restore wait for its token instead of refreshing again', async () => {
    const api = fakeApi({ refreshTokens: ['t1'], validTokens: ['t1'], holdRefresh: true });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });

    const restoring = store.restore();
    await vi.waitFor(() => expect(api.count('/v1/auth/refresh')).toBe(1));
    const meCall = store.api.GET('/v1/auth/me');
    api.release();
    await restoring;
    const { response } = await meCall;

    expect(response.status).toBe(200);
    expect(api.count('/v1/auth/refresh')).toBe(1);
    const meAuth = api.seen.filter((s) => s.path === '/v1/auth/me').map((s) => s.auth);
    expect(meAuth).toEqual(['Bearer t1', 'Bearer t1']);
  });

  it('is anonymous, without calling /me, when there is no refresh cookie', async () => {
    const api = fakeApi({ refreshTokens: [], validTokens: [] });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    const listener = vi.fn();
    store.subscribe(listener);

    await store.restore();

    expect(store.getState()).toEqual({ status: 'anonymous', user: null });
    expect(api.count('/v1/auth/me')).toBe(0);
    expect(listener).toHaveBeenCalled();
    expect(await store.getAccessToken()).toBeNull();
  });

  it('treats a network failure during restore as anonymous (no crash)', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('network down');
    };
    const store = createAuthStore({ baseUrl: BASE, fetch: failing });
    await expect(store.restore()).resolves.toEqual({ status: 'anonymous', user: null });
  });

  it('signOut revokes the session server-side and clears the in-memory token + user', async () => {
    const api = fakeApi({ refreshTokens: ['t1'], validTokens: ['t1'] });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    await store.restore();

    await expect(store.signOut()).resolves.toBe(true);

    expect(api.seen.find((s) => s.path === '/v1/auth/logout')).toMatchObject({
      method: 'POST',
      auth: 'Bearer t1',
    });
    expect(store.getState()).toEqual({ status: 'anonymous', user: null });
    expect(await store.getAccessToken()).toBeNull();
  });

  it('signOut reports failure and keeps the session when the API does not confirm the logout', async () => {
    const api = fakeApi({ refreshTokens: ['t1'], validTokens: ['t1'] });
    let mode: 'ok' | 'offline' | '503' = 'ok';
    const fetchImpl: typeof fetch = async (input, init) => {
      if (mode === 'offline') throw new TypeError('offline');
      if (mode === '503') return error(503, 'common.error.internal');
      return api.fetch(input, init);
    };
    const store = createAuthStore({ baseUrl: BASE, fetch: fetchImpl });
    await store.restore();

    mode = 'offline';
    await expect(store.signOut()).resolves.toBe(false);
    mode = '503';
    await expect(store.signOut()).resolves.toBe(false);

    // Still signed in: the refresh cookie would have restored the session on reload anyway.
    expect(store.getState().status).toBe('authenticated');
    expect(await store.getAccessToken()).toBe('t1');
  });

  it('a restore still in flight when the user signs out does not resurrect the session', async () => {
    const api = fakeApi({ refreshTokens: ['t1'], validTokens: ['t1'], holdRefresh: true });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });

    const restoring = store.restore();
    await vi.waitFor(() => expect(api.count('/v1/auth/refresh')).toBe(1));
    const signingOut = store.signOut();
    api.release();
    await Promise.all([restoring, signingOut]);

    expect(store.getState()).toEqual({ status: 'anonymous', user: null });
    expect(await store.getAccessToken()).toBeNull();
  });

  it('restore() is a no-op once authenticated', async () => {
    const api = fakeApi({ refreshTokens: ['t1', 't2'], validTokens: ['t1'] });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    await store.restore();
    await store.restore();
    expect(api.count('/v1/auth/refresh')).toBe(1);
  });

  it('on 401 the SDK refreshes once, retries with the new token, and the store keeps it', async () => {
    const validTokens = ['t1'];
    const api = fakeApi({ refreshTokens: ['t1', 't2'], validTokens });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    await store.restore();
    // t1 expires; only t2 is accepted from now on.
    validTokens.splice(0, validTokens.length, 't2');

    const [first, second] = await Promise.all([
      store.api.GET('/v1/auth/me'),
      store.api.GET('/v1/auth/me'),
    ]);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(api.count('/v1/auth/refresh')).toBe(2); // restore + ONE shared retry refresh
    expect(await store.getAccessToken()).toBe('t2');
    expect(store.getState().status).toBe('authenticated');
  });

  it('a rejected refresh after a 401 signs the user out (onUnauthorized)', async () => {
    const validTokens = ['t1'];
    const api = fakeApi({ refreshTokens: ['t1'], validTokens });
    const store = createAuthStore({ baseUrl: BASE, fetch: api.fetch });
    await store.restore();
    validTokens.length = 0;

    const { response } = await store.api.GET('/v1/auth/me');

    expect(response.status).toBe(401);
    expect(store.getState()).toEqual({ status: 'anonymous', user: null });
    expect(await store.getAccessToken()).toBeNull();
  });

  it('builds the OAuth start URL for the web app', () => {
    const store = createAuthStore({
      baseUrl: `${BASE}/`,
      fetch: fakeApi({ refreshTokens: [], validTokens: [] }).fetch,
    });
    expect(store.oauthStartUrl('google')).toBe(`${BASE}/v1/auth/google?app=web`);
    expect(store.oauthStartUrl('facebook')).toBe(`${BASE}/v1/auth/facebook?app=web`);
  });
});
