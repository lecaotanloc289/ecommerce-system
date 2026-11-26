import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@repo/core';
import { Button } from '@repo/ui';
import { Splash } from '@/components/splash';
import { useT } from '@/i18n/use-locale';
import { hasAnyRole } from './roles';
import { authStore, useAuth, useCurrentUser } from './session';

export interface LoginLocationState {
  /** Path + search the user asked for before being sent to `/login`. */
  from?: string;
}

/**
 * Layout route: renders the child routes only for an `authenticated` session. While the boot
 * refresh runs it shows the splash; anonymous users go to `/login` (remembering the deep link).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();

  if (status === 'restoring') return <Splash />;
  if (status === 'error') return <SessionErrorScreen />;
  if (status === 'anonymous') {
    const state: LoginLocationState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return children ?? <Outlet />;
}

/**
 * Renders its children (or child routes) only if the user holds at least one of `roles`;
 * otherwise redirects to `fallback` (`/` re-routes by role: other portal, chooser or no access).
 * Always nest under `RequireAuth`. This is UX only — the API enforces `@Roles` on every route.
 */
export function RequireRole({
  roles,
  fallback = '/',
  children,
}: {
  roles: readonly Role[];
  fallback?: string;
  children?: ReactNode;
}) {
  const user = useCurrentUser();
  if (!hasAnyRole(user.roles, roles)) return <Navigate to={fallback} replace />;
  return children ?? <Outlet />;
}

function SessionErrorScreen() {
  const t = useT();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg-page p-6 text-center">
      <p role="alert" className="max-w-md text-body-m text-text-body">
        {t('admin.error.network')}
      </p>
      <Button onClick={() => void authStore.getState().restoreSession()}>
        {t('admin.error.retry')}
      </Button>
    </div>
  );
}
