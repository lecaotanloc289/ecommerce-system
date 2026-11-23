'use client';

import * as React from 'react';
import type { MeResponse } from '@repo/core';
import { getAuthStore } from '@/lib/api/browser';
import { saveReturnTo } from '@/lib/return-to';
import { LOADING_STATE, type AuthState, type AuthStatus, type OAuthProvider } from './auth-store';

interface AuthContextValue {
  status: AuthStatus;
  user: MeResponse | null;
  /** Remember `returnTo` (a locale-less path) and navigate to the provider's OAuth start URL. */
  signIn: (provider: OAuthProvider, returnTo?: string | null) => void;
  /** False when the API did not confirm the logout (session kept). */
  signOut: () => Promise<boolean>;
  /** Re-run the (single-flight) session restore — the OAuth callback page awaits it. */
  restore: () => Promise<AuthState>;
  /** Force a token refresh + profile re-read (e.g. to pick up a newly granted vendor role). */
  reload: () => Promise<AuthState>;
  /** Re-read the profile without rotating the token. */
  refreshUser: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const subscribe = (listener: () => void) => getAuthStore().subscribe(listener);
const getSnapshot = () => getAuthStore().getState();
// SSR / prerender: nobody is signed in on the server (the token only ever lives in the browser).
const getServerSnapshot = () => LOADING_STATE;

// Module-level, so their identity is stable across renders (safe in effect dependencies).
const signIn: AuthContextValue['signIn'] = (provider, returnTo) => {
  saveReturnTo(returnTo);
  window.location.assign(getAuthStore().oauthStartUrl(provider));
};
const signOut = () => getAuthStore().signOut();
const restore = () => getAuthStore().restore();
const reload = () => getAuthStore().reload();
const refreshUser = () => getAuthStore().refreshUser();

/**
 * Mounted once in `StorefrontShell`. On mount it tries one silent refresh so a reload keeps
 * the user signed in; the token itself never leaves the auth store's memory.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  React.useEffect(() => {
    void getAuthStore().restore();
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      signIn,
      signOut,
      restore,
      reload,
      refreshUser,
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
