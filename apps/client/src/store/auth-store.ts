import { createApiClient, type ApiClient } from '@repo/sdk';
import { MeResponseSchema, TokenResponseSchema, type MeResponse } from '@repo/core';

/**
 * Browser auth session (Golden Rule #5). Framework-free so it can be unit-tested; React glue
 * is `AuthProvider` / `useAuth` in `./auth-provider.tsx`.
 *
 * - The access token lives ONLY in this closure (memory) — never in localStorage /
 *   sessionStorage / cookies. A reload loses it; `restore()` gets a new one from the HttpOnly
 *   refresh cookie (`POST /v1/auth/refresh`, credentials included).
 * - `restore()` is single-flight: concurrent callers (StrictMode double effects, the provider
 *   and the OAuth callback page) share one refresh, because the server rotates the cookie.
 * - While a restore refresh is in flight, `getAccessToken` waits for it, so API calls made
 *   meanwhile carry the new token instead of triggering a second (SDK) refresh.
 * - 401 on any other call → the SDK does its own single-flight refresh + one retry and hands
 *   the new token to `onAccessToken`; a rejected refresh → `onUnauthorized` → signed out.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: MeResponse | null;
}

export type OAuthProvider = 'google' | 'facebook';

export interface AuthStore {
  /** Typed API client wired to this session (Bearer token, refresh on 401). */
  readonly api: ApiClient;
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  /** Current in-memory access token (awaits an in-flight restore refresh). */
  getAccessToken(): Promise<string | null>;
  /**
   * Restore the session from the refresh cookie, then load `GET /v1/auth/me`. Single-flight;
   * resolves immediately when already authenticated.
   */
  restore(): Promise<AuthState>;
  /**
   * Force a new `POST /v1/auth/refresh` + `GET /v1/auth/me` even when already signed in, so
   * freshly granted roles (approved vendor application) show up. A failure keeps the current
   * session. Shares the in-flight restore, if any.
   */
  reload(): Promise<AuthState>;
  /**
   * Revoke the session server-side (`POST /v1/auth/logout`), then forget the token + user.
   * Resolves false — and keeps the session — when the API did not confirm (network/5xx/429):
   * the refresh cookie would otherwise sign the user back in on the next page load.
   */
  signOut(): Promise<boolean>;
  /** `${origin}/v1/auth/<provider>?app=web` — where the sign-in buttons navigate. */
  oauthStartUrl(provider: OAuthProvider): string;
}

export interface AuthStoreOptions {
  /** API origin without `/v1`. */
  baseUrl: string;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export const LOADING_STATE: AuthState = { status: 'loading', user: null };
const ANONYMOUS_STATE: AuthState = { status: 'anonymous', user: null };

export function createAuthStore(options: AuthStoreOptions): AuthStore {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  let accessToken: string | null = null;
  let state: AuthState = LOADING_STATE;
  let restoring: Promise<AuthState> | null = null;
  let refreshing: Promise<string | null> | null = null;
  // Bumped by signOut: a restore that started before it must not resurrect the session.
  let epoch = 0;
  const listeners = new Set<() => void>();

  function setState(next: AuthState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function clearSession(): void {
    accessToken = null;
    setState(ANONYMOUS_STATE);
  }

  async function getAccessToken(): Promise<string | null> {
    if (refreshing) await refreshing;
    return accessToken;
  }

  const api = createApiClient({
    baseUrl,
    fetch: doFetch,
    getAccessToken,
    onAccessToken: (token) => {
      accessToken = token;
    },
    onUnauthorized: clearSession,
  });

  /** One `POST /v1/auth/refresh`; null when there is no valid session (or the network failed). */
  async function requestToken(): Promise<string | null> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    const parsed = TokenResponseSchema.safeParse(body);
    return parsed.success ? parsed.data.accessToken : null;
  }

  async function loadSession(keepOnFailure = false): Promise<AuthState> {
    const started = epoch;
    const current = () => epoch === started;
    refreshing = requestToken().then((token) => {
      if (current() && (token !== null || !keepOnFailure)) accessToken = token;
      return current() ? token : null;
    });
    let token: string | null;
    try {
      token = await refreshing;
    } finally {
      refreshing = null;
    }
    if (!current()) return state;
    if (token === null) {
      if (!keepOnFailure) clearSession();
      return state;
    }
    const { data } = await api.GET('/v1/auth/me').catch(() => ({ data: undefined }));
    if (!current()) return state;
    const me = MeResponseSchema.safeParse(data);
    if (!me.success) {
      if (!keepOnFailure) clearSession();
      return state;
    }
    setState({ status: 'authenticated', user: me.data });
    return state;
  }

  function restore(): Promise<AuthState> {
    if (state.status === 'authenticated' && !restoring) return Promise.resolve(state);
    restoring ??= loadSession().finally(() => {
      restoring = null;
    });
    return restoring;
  }

  function reload(): Promise<AuthState> {
    restoring ??= loadSession(true).finally(() => {
      restoring = null;
    });
    return restoring;
  }

  async function signOut(): Promise<boolean> {
    epoch++;
    let confirmed = false;
    try {
      const { response } = await api.POST('/v1/auth/logout');
      confirmed = response.ok;
    } catch {
      confirmed = false; // network failure
    }
    if (confirmed) clearSession();
    return confirmed;
  }

  return {
    api,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getAccessToken,
    restore,
    reload,
    signOut,
    oauthStartUrl: (provider) => `${baseUrl}/v1/auth/${provider}?app=web`,
  };
}
