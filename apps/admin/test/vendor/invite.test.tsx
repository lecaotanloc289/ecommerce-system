import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@repo/core';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { appRoutes } from '@/router/routes';
import { json, makeUser, VENDOR_ID } from '../fixtures';
import { EMPTY_PAGE, stubApi, TOKEN } from './fake-api';

const INVITE_TOKEN = 'invite-token-0123456789abcdef';
const PATH = `/invite?token=${INVITE_TOKEN}`;

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

beforeEach(() => {
  sessionStorage.clear();
  useLocaleStore.setState({ locale: 'en' });
  authStore.setState({ status: 'anonymous', accessToken: null, user: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('/invite', () => {
  it('signed out → /login, keeping the deep link with the token', async () => {
    const router = renderAt(PATH);
    expect(await screen.findByRole('heading', { name: 'Sign in to Elma Admin' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: PATH });
  });

  it('a link without a usable token says so and never calls the API', () => {
    const fake = stubApi({});
    signInAs(['CUSTOMER']);
    renderAt('/invite?token=short');
    expect(screen.getByText(/invitation link is incomplete/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it('accept → refresh session → /vendor', async () => {
    const owner = makeUser(['VENDOR_OWNER']);
    const fake = stubApi({
      'POST /v1/vendor-invitations/accept': () => json({ vendorId: VENDOR_ID }),
      'POST /v1/auth/refresh': () => json(TOKEN),
      'GET /v1/auth/me': () => json(owner),
      'GET /v1/vendor/sub-orders': () => json(EMPTY_PAGE),
      'GET /v1/vendor/wallet': () =>
        json({
          id: '01JC0000000000000000000WA1',
          vendorId: VENDOR_ID,
          balance: { amount: 0, currency: 'VND' },
          pending: [],
        }),
    });
    signInAs(['CUSTOMER']);
    const router = renderAt(PATH);

    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/vendor'));
    const accept = fake.find('POST /v1/vendor-invitations/accept')[0];
    expect(await accept?.json()).toEqual({ token: INVITE_TOKEN });
    expect(accept?.headers.get('Idempotency-Key')).toBeTruthy();
    // The new role only exists in a fresh token: refresh + /me ran after accepting.
    expect(fake.find('POST /v1/auth/refresh')).toHaveLength(1);
    expect(authStore.getState().user?.roles).toContain('VENDOR_OWNER');
  });

  it.each([
    [422, 'invitation.error.invalid', 'This invitation is invalid or has already been used.'],
    [410, 'invitation.error.expired', 'This invitation has expired.'],
    [
      403,
      'invitation.error.email-mismatch',
      'This invitation was sent to a different email than your account.',
    ],
  ])('%d %s is translated', async (status, errorCode, text) => {
    stubApi({
      'POST /v1/vendor-invitations/accept': () => json({ errorCode, params: {} }, status),
    });
    signInAs(['CUSTOMER']);
    const router = renderAt(PATH);
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(router.state.location.pathname).toBe('/invite'); // stays, can retry or switch account
  });

  it('409 conflict explains the one-shop-per-account limit', async () => {
    stubApi({
      'POST /v1/vendor-invitations/accept': () =>
        json({ errorCode: 'common.error.conflict', params: {} }, 409),
    });
    signInAs(['CUSTOMER']);
    renderAt(PATH);
    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText(/already belongs to a shop/)).toBeTruthy();
  });

  it('shows the translated text in Vietnamese too', async () => {
    useLocaleStore.setState({ locale: 'vi' });
    stubApi({
      'POST /v1/vendor-invitations/accept': () =>
        json({ errorCode: 'invitation.error.expired', params: {} }, 410),
    });
    signInAs(['CUSTOMER']);
    renderAt(PATH);
    await userEvent.click(screen.getByRole('button', { name: 'Chấp nhận lời mời' }));
    expect(await screen.findByText('Lời mời đã hết hạn.')).toBeTruthy();
  });
});
