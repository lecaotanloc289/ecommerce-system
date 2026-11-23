import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@repo/core';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { appRoutes } from '@/router/routes';
import { json, makeUser, VENDOR_ID } from '../fixtures';
import { stubApi } from './fake-api';

/** A USD shop: the wallet currency is the only currency it may price in (server rule). */
const USD_WALLET = {
  id: '01JC0000000000000000000WA1',
  vendorId: VENDOR_ID,
  balance: { amount: 0, currency: 'USD' },
  pending: [],
};

const routes = {
  'GET /v1/vendor/wallet': () => json(USD_WALLET),
  'GET /v1/categories': () => json({ items: [] }),
  'GET /v1/vendor/shipping-methods': () => json([]),
};

function renderAs(roles: Role[], path: string) {
  authStore.setState({ status: 'authenticated', accessToken: 'token', user: makeUser(roles) });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

beforeEach(() => useLocaleStore.setState({ locale: 'en' }));
afterEach(() => {
  authStore.setState({ status: 'anonymous', accessToken: null, user: null });
  vi.unstubAllGlobals();
});

describe('shop currency = wallet currency', () => {
  it('a new product of an owner is priced in the wallet currency, with no other choice', async () => {
    stubApi(routes);
    renderAs(['VENDOR_OWNER'], '/vendor/products/new');
    expect((await screen.findAllByText('USD')).length).toBeGreaterThan(0);
    expect(screen.queryByText('VND')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Currency' })).toBeNull();
  });

  it('staff cannot read the wallet: every currency stays selectable, no wallet request', async () => {
    const fake = stubApi(routes);
    renderAs(['VENDOR_STAFF'], '/vendor/products/new');
    const select = await screen.findByRole('combobox', { name: 'Currency' });
    expect(optionsOf(select)).toEqual(['VND', 'USD']);
    expect(fake.find('GET /v1/vendor/wallet')).toHaveLength(0);
  });

  it('a new shipping method of an owner offers only the wallet currency', async () => {
    stubApi(routes);
    renderAs(['VENDOR_OWNER'], '/vendor/shipping');
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(await screen.findByRole('button', { name: 'New shipping method' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByRole('combobox', { name: 'Currency' });
    expect(optionsOf(select)).toEqual(['USD']);
  });
});
