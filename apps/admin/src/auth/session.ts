import type { MeResponse } from '@repo/core';
import { useStore } from 'zustand';
import { env } from '@/env';
import { createSession, type AuthState } from './auth-store';

/** App-wide session: the in-memory auth store + the typed `@repo/sdk` client bound to it. */
export const { authStore, api } = createSession({ baseUrl: env.apiUrl });

export function useAuth<T>(selector: (state: AuthState) => T): T {
  return useStore(authStore, selector);
}

/**
 * The signed-in user. Only call below `RequireAuth`, which renders its children only once the
 * session is `authenticated` — so a missing user here is a routing bug, not a runtime state.
 */
export function useCurrentUser(): MeResponse {
  const user = useAuth((s) => s.user);
  if (!user) throw new Error('useCurrentUser() used outside <RequireAuth>');
  return user;
}
