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
  /** Revoke the refresh cookie server-side (best effort) and drop the in-memory session. */
  signOut: () => Promise<void>;
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

  const authStore = createStore<AuthState>()((set) => ({
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
        await api.POST('/v1/auth/logout');
      } catch {
        // Offline: the cookie stays valid until it expires, but this tab forgets the session.
      }
      set(SIGNED_OUT);
    },
  }));

  const api = createApiClient({
    baseUrl: options.baseUrl,
    getAccessToken: () => authStore.getState().accessToken,
    onAccessToken: (accessToken) => authStore.setState({ accessToken }),
    onUnauthorized: () => authStore.setState(SIGNED_OUT),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  async function restore(): Promise<void> {
    authStore.setState({ status: 'restoring' });
    try {
      const refreshed = await api.POST('/v1/auth/refresh');
      if (!refreshed.response.ok) {
        authStore.setState(
          isSessionRejected(refreshed.response) ? SIGNED_OUT : { status: 'error' },
        );
        return;
      }
      const token = TokenResponseSchema.safeParse(refreshed.data);
      if (!token.success) {
        authStore.setState({ status: 'error' });
        return;
      }
      authStore.setState({ accessToken: token.data.accessToken });

      const me = await api.GET('/v1/auth/me');
      if (!me.response.ok) {
        authStore.setState(isSessionRejected(me.response) ? SIGNED_OUT : { status: 'error' });
        return;
      }
      const user = MeResponseSchema.safeParse(me.data);
      authStore.setState(
        user.success ? { status: 'authenticated', user: user.data } : { status: 'error' },
      );
    } catch {
      authStore.setState({ status: 'error' }); // network failure: not proof the session is over
    }
  }

  return { authStore, api };
}

function isSessionRejected(response: Response): boolean {
  return response.status === 401 || response.status === 403;
}
