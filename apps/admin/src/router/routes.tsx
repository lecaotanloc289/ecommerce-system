import type { RouteObject } from 'react-router';
import { RequireAuth, RequireRole } from '@/auth/guards';
import { PortalLayout } from '@/components/layout/portal-layout';
import { AuthCallbackPage } from '@/pages/auth-callback-page';
import { HomePage } from '@/pages/home-page';
import { InvitePage } from '@/pages/invite-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { PLATFORM_PORTAL, VENDOR_PORTAL, type PortalConfig } from './portals';

/** `/vendor/*` or `/platform/*`: portal role gate → layout → one route per configured page. */
function portalRoute(config: PortalConfig): RouteObject {
  return {
    path: config.basePath,
    element: (
      <RequireRole roles={config.roles}>
        <PortalLayout config={config} />
      </RequireRole>
    ),
    children: [
      ...config.pages.map(({ path, roles, element }): RouteObject => {
        const guarded = roles ? (
          <RequireRole roles={roles} fallback={config.basePath}>
            {element}
          </RequireRole>
        ) : (
          element
        );
        return path === '' ? { index: true, element: guarded } : { path, element: guarded };
      }),
      ...(config.subRoutes ?? []).map(
        ({ path, roles, element }): RouteObject => ({
          path,
          element: roles ? (
            <RequireRole roles={roles} fallback={config.basePath}>
              {element}
            </RequireRole>
          ) : (
            element
          ),
        }),
      ),
      { path: '*', element: <NotFoundPage /> },
    ],
  };
}

/** Route table for `createBrowserRouter` (app) and `createMemoryRouter` (tests). */
export const appRoutes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/invite', element: <InvitePage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <HomePage /> },
          portalRoute(VENDOR_PORTAL),
          portalRoute(PLATFORM_PORTAL),
        ],
      },
      {
        path: '*',
        element: (
          <div className="min-h-svh bg-bg-surface">
            <NotFoundPage />
          </div>
        ),
      },
    ],
  },
];
