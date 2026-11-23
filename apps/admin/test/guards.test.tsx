import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@repo/core';
import { readReturnPath, saveReturnPath } from '@/auth/return-path';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { appRoutes } from '@/router/routes';
import { makeUser } from './fixtures';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function signInAs(roles: Role[]) {
  authStore.setState({ status: 'authenticated', accessToken: 'token', user: makeUser(roles) });
}

function signOut() {
  authStore.setState({ status: 'anonymous', accessToken: null, user: null });
}

const sidebar = () => screen.getByRole('navigation', { name: 'Main navigation' });
const navLinks = () =>
  within(sidebar())
    .getAllByRole('link')
    .map((link) => link.textContent);

beforeEach(() => {
  sessionStorage.clear();
  useLocaleStore.setState({ locale: 'en' });
  signOut();
});

describe('anonymous', () => {
  it.each(['/', '/vendor', '/vendor/products', '/platform/settings'])(
    '%s → /login',
    async (path) => {
      const router = renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Sign in to Elma Admin' })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.state).toEqual({ from: path });
    },
  );

  it('sees the splash, not the login page, while the boot refresh runs', () => {
    authStore.setState({ status: 'restoring' });
    renderAt('/platform/settings');
    expect(screen.getByRole('status').textContent).toContain('Restoring your session');
  });

  it('gets a retry screen when the API is unreachable', () => {
    authStore.setState({ status: 'error' });
    renderAt('/vendor');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('can open the invitation placeholder', () => {
    renderAt('/invite?token=abc');
    expect(screen.getByRole('heading', { name: 'Staff invitation' })).toBeTruthy();
  });
});

describe('customer without admin roles', () => {
  it.each(['/', '/vendor', '/platform/orders'])(
    '%s → no access page with sign-out',
    async (path) => {
      signInAs(['CUSTOMER']);
      const router = renderAt(path);
      expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/');
    },
  );
});

describe('vendor roles', () => {
  it('/ sends a vendor straight to the vendor portal', async () => {
    signInAs(['CUSTOMER', 'VENDOR_OWNER']);
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Vendor portal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/vendor');
  });

  it('VENDOR_OWNER sees every vendor page including Wallet and Staff', async () => {
    signInAs(['CUSTOMER', 'VENDOR_OWNER']);
    renderAt('/vendor/wallet');
    expect(await screen.findByRole('heading', { name: 'Wallet' })).toBeTruthy();
    expect(navLinks()).toEqual(['Dashboard', 'Products', 'Orders', 'Shipping', 'Wallet', 'Staff']);
  });

  it('VENDOR_STAFF does not see owner-only items', async () => {
    signInAs(['CUSTOMER', 'VENDOR_STAFF']);
    renderAt('/vendor/products');
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeTruthy();
    expect(navLinks()).toEqual(['Dashboard', 'Products', 'Orders', 'Shipping']);
  });

  it.each(['/vendor/wallet', '/vendor/staff'])(
    'VENDOR_STAFF deep-linking %s lands on the vendor dashboard',
    async (path) => {
      signInAs(['VENDOR_STAFF']);
      const router = renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Vendor portal' })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/vendor');
    },
  );

  it('a vendor cannot open the platform console', async () => {
    signInAs(['VENDOR_OWNER']);
    const router = renderAt('/platform/applications');
    expect(await screen.findByRole('heading', { name: 'Vendor portal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/vendor');
  });

  it('shows a 404 inside the portal for an unknown page', async () => {
    signInAs(['VENDOR_OWNER']);
    renderAt('/vendor/nope');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(sidebar()).toBeTruthy();
  });
});

describe('platform roles', () => {
  it('PLATFORM_STAFF does not see admin-only items', async () => {
    signInAs(['PLATFORM_STAFF']);
    renderAt('/platform');
    expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeTruthy();
    expect(navLinks()).toEqual([
      'Dashboard',
      'Applications',
      'Vendors',
      'Products',
      'Orders',
      'Refunds',
    ]);
  });

  it.each(['/platform/settings', '/platform/users'])(
    'PLATFORM_STAFF deep-linking %s lands on the platform dashboard',
    async (path) => {
      signInAs(['PLATFORM_STAFF']);
      const router = renderAt(path);
      expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/platform');
    },
  );

  it('PLATFORM_ADMIN opens settings and sees every item', async () => {
    signInAs(['PLATFORM_ADMIN']);
    renderAt('/platform/settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(navLinks()).toContain('Settings');
    expect(navLinks()).toContain('Users');
  });

  it('a platform user cannot open the vendor portal', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const router = renderAt('/vendor/orders');
    expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/platform');
  });
});

describe('vendor + platform roles', () => {
  it('/ shows the workspace chooser with both portals', async () => {
    signInAs(['VENDOR_OWNER', 'PLATFORM_STAFF']);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Choose a workspace' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Vendor portal/ }).getAttribute('href')).toBe(
      '/vendor',
    );
    expect(screen.getByRole('link', { name: /Platform console/ }).getAttribute('href')).toBe(
      '/platform',
    );
  });

  it('can open both portals and switch between them', async () => {
    signInAs(['VENDOR_STAFF', 'PLATFORM_ADMIN']);
    renderAt('/platform/users');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Switch workspace' }).getAttribute('href')).toBe('/');
  });
});

describe('public pages', () => {
  it('an authenticated user visiting /login is sent on by role', async () => {
    signInAs(['PLATFORM_STAFF']);
    const router = renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/platform');
  });

  it('/auth/callback shows the translated OAuth error', () => {
    renderAt('/auth/callback?error=auth.error.oauth-failed');
    expect(screen.getByRole('heading', { name: 'Sign-in failed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('/auth/callback sends the user to the deep link saved before OAuth, then forgets it', async () => {
    saveReturnPath('/platform/refunds?status=open');
    signInAs(['PLATFORM_STAFF']);
    const router = renderAt('/auth/callback');
    expect(await screen.findByRole('heading', { name: 'Refunds' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/platform/refunds');
    expect(router.state.location.search).toBe('?status=open');
    expect(readReturnPath()).toBe('/');
  });

  it('/auth/callback ignores an unsafe saved path', async () => {
    sessionStorage.setItem('admin.returnTo', '//evil.example');
    signInAs(['VENDOR_OWNER']);
    const router = renderAt('/auth/callback');
    expect(await screen.findByRole('heading', { name: 'Vendor portal' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/vendor');
  });

  it('/auth/callback offers a retry (not a new login) when the API was unreachable', () => {
    authStore.setState({ status: 'error' });
    renderAt('/auth/callback');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('unknown top-level paths render the 404 page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });

  it('renders in Vietnamese when the locale is vi', async () => {
    useLocaleStore.setState({ locale: 'vi' });
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'Đăng nhập Elma Admin' })).toBeTruthy();
  });
});
