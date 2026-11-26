import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@repo/core';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { appRoutes } from '@/router/routes';
import { json, makeUser, VENDOR_ID } from '../fixtures';
import { EMPTY_PAGE, stubApi } from './fake-api';

const WALLET = {
  id: '01JC0000000000000000000WA1',
  vendorId: VENDOR_ID,
  balance: { amount: 250000, currency: 'VND' },
  pending: [{ amount: 1999, currency: 'USD' }],
};

function renderAs(roles: Role[], path: string) {
  authStore.setState({ status: 'authenticated', accessToken: 'token', user: makeUser(roles) });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const routes = {
  'GET /v1/vendor/wallet': () => json(WALLET),
  'GET /v1/vendor/ledger': () => json(EMPTY_PAGE),
  'GET /v1/vendor/staff': () => json([]),
  'GET /v1/vendor/invitations': () => json(EMPTY_PAGE),
  'GET /v1/vendor/sub-orders': () => json(EMPTY_PAGE),
};

beforeEach(() => useLocaleStore.setState({ locale: 'en' }));
afterEach(() => vi.unstubAllGlobals());

describe('owner-only pages', () => {
  it('VENDOR_OWNER opens the wallet and sees balance + pending per currency', async () => {
    stubApi(routes);
    renderAs(['VENDOR_OWNER'], '/vendor/wallet');
    expect(await screen.findByText('Released balance')).toBeTruthy();
    expect(screen.getByText(/250,000/)).toBeTruthy();
    expect(screen.getByText(/19,99|19\.99/)).toBeTruthy();
  });

  it('VENDOR_OWNER opens the staff page', async () => {
    stubApi(routes);
    renderAs(['VENDOR_OWNER'], '/vendor/staff');
    expect(await screen.findByLabelText('Invite by email')).toBeTruthy();
  });

  it.each(['/vendor/wallet', '/vendor/staff'])(
    'VENDOR_STAFF at %s is sent to the dashboard without any owner-only request',
    async (path) => {
      const fake = stubApi(routes);
      const router = renderAs(['VENDOR_STAFF'], path);
      await screen.findByText('Paid orders to accept');
      expect(router.state.location.pathname).toBe('/vendor');
      const paths = fake.calls.map((request) => new URL(request.url).pathname);
      expect(paths).not.toContain('/v1/vendor/wallet');
      expect(paths).not.toContain('/v1/vendor/ledger');
      expect(paths).not.toContain('/v1/vendor/staff');
      expect(paths).not.toContain('/v1/vendor/invitations');
    },
  );

  it('the dashboard shows the wallet tile to owners only', async () => {
    stubApi(routes);
    renderAs(['VENDOR_OWNER'], '/vendor');
    expect(await screen.findByText('Wallet balance')).toBeTruthy();
  });

  it('staff sidebar has no Wallet / Staff links, owner has both', async () => {
    stubApi(routes);
    renderAs(['VENDOR_STAFF'], '/vendor');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).queryByRole('link', { name: 'Wallet' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Staff' })).toBeNull();
  });
});
