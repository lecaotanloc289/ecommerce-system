import { createApiClient, MeResponseSchema, TokenResponseSchema, type ApiClient } from '@repo/sdk';
import type { MeResponse } from '@repo/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * - `restoring`: boot / retry refresh in flight (show the splash)
 * - `authenticated`: access token in memory + `user` loaded
 * - `anonymous`: no session (refresh rejected, signed out, or session ended mid-use)
 * - `error`: the API was unreachable or failed (5xx) — the session may still be valid, offer retry
 */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous' | 'error';

export interface AuthState {
  status: AuthStatus;
  /** Access JWT — memory only (Golden Rule #5). Never persisted, never put in storage. */
  accessToken: string | null;
  user: MeResponse | null;
  /** Boot / retry: refresh cookie → access token → `GET /v1/auth/me`. Single-flight. */
  restoreSession: () => Promise<void>;
  /**
   * Revoke the refresh cookie (`POST /v1/auth/logout`), then drop the in-memory session.
   * Resolves `false` — and keeps the session — when the revoke failed (offline / 5xx): the cookie
   * would still sign the user back in on reload, so the UI must say so instead of faking it.
   */
  signOut: () => Promise<boolean>;
}

export interface Session {
  authStore: StoreApi<AuthState>;
  api: ApiClient;
}

export interface SessionOptions {
  baseUrl: string;
  /** Custom fetch for tests. */
  fetch?: typeof fetch;
}

const SIGNED_OUT = { status: 'anonymous', accessToken: null, user: null } as const;

/**
 * Creates the auth store and the typed API client wired to it: the client reads the token from
 * the store, writes back every token it obtains by an automatic 401 → refresh (single-flight in
 * `@repo/sdk`), and ends the session when the refresh is rejected.
 */
export function createSession(options: SessionOptions): Session {
  let inflightRestore: Promise<void> | null = null;
  // Bumped whenever the session ends. A `restore()` that began earlier (the user signed out, or
  // the SDK refresh was rejected, while it was in flight) must not resurrect the session.
  let epoch = 0;

  function endSession(): void {
    epoch += 1;
    authStore.setState(SIGNED_OUT);
  }

  const authStore = createStore<AuthState>()(() => ({
    status: 'restoring',
    accessToken: null,
    user: null,

    restoreSession() {
      // StrictMode double effects, the boot call and /auth/callback all share one refresh: the
      // server rotates the refresh cookie, so parallel refreshes would race each other.
      inflightRestore ??= restore().finally(() => {
        inflightRestore = null;
      });
      return inflightRestore;
    },

    async signOut() {
      try {
        const { response } = await api.POST('/v1/auth/logout');
        // 401: there was no live session to revoke — signed out either way.
        if (!response.ok && response.status !== 401) return false;
      } catch {
        return false; // offline: the cookie was NOT revoked
      }
      endSession();
      return true;
    },
  }));

  const api = createApiClient({
    baseUrl: options.baseUrl,
    getAccessToken: () => authStore.getState().accessToken,
    onAccessToken: (accessToken) => authStore.setState({ accessToken }),
    onUnauthorized: endSession,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  async function restore(): Promise<void> {
    const attempt = epoch;
    /** Apply a result only if the session was not ended since this attempt began. */
    const settle = (state: Partial<AuthState>) => {
      if (attempt === epoch) authStore.setState(state);
    };

    authStore.setState({ status: 'restoring' });
    try {
      const refreshed = await api.POST('/v1/auth/refresh');
      if (!refreshed.response.ok) {
        settle(isSessionRejected(refreshed.response) ? SIGNED_OUT : { status: 'error' });
        return;
      }
      const token = TokenResponseSchema.safeParse(refreshed.data);
      if (!token.success) {
        settle({ status: 'error' });
        return;
      }
      if (attempt !== epoch) return; // session ended meanwhile: don't fetch /me for it
      settle({ accessToken: token.data.accessToken });

      const me = await api.GET('/v1/auth/me');
      if (!me.response.ok) {
        settle(isSessionRejected(me.response) ? SIGNED_OUT : { status: 'error' });
        return;
      }
      const user = MeResponseSchema.safeParse(me.data);
      settle(user.success ? { status: 'authenticated', user: user.data } : { status: 'error' });
    } catch {
      settle({ status: 'error' }); // network failure: not proof the session is over
    }
  }

  return { authStore, api };
}

function isSessionRejected(response: Response): boolean {
  return response.status === 401 || response.status === 403;
}
