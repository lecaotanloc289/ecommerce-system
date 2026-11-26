import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@repo/core';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { ApiError, errorMessage } from '@/lib/api-error';
import { appRoutes } from '@/router/routes';
import { json, makeUser } from './fixtures';

type Handler = (request: Request) => Response | Promise<Response>;

const EMPTY_PAGE = { items: [], nextCursor: null };

/** Fake `fetch` routing by `METHOD /path`; unknown GETs answer an empty page. Records every call. */
function fakeApi(routes: Record<string, Handler> = {}) {
  const calls: Request[] = [];
  const fetchFn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const handler = routes[route];
    if (handler) return Promise.resolve(handler(request));
    if (request.method === 'GET') return Promise.resolve(json(EMPTY_PAGE));
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal('fetch', fetchFn);
  const posts = (route: string) =>
    calls.filter((r) => `${r.method} ${new URL(r.url).pathname}` === route);
  return { calls, posts };
}

const err = (status: number, errorCode: string, params: Record<string, string> = {}) =>
  json({ errorCode, params }, status);

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function signInAs(roles: Role[]) {
  authStore.setState({ status: 'authenticated', accessToken: 'token', user: makeUser(roles) });
}

/** The i-th recorded request; fails the test (instead of `!`) when it was never sent. */
function nth(list: Request[], index: number): Request {
  const request = list[index];
  if (!request) throw new Error(`request #${index} was not sent`);
  return request;
}

const ui = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  // Radix Checkbox measures its bubble input with ResizeObserver, which jsdom lacks.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  authStore.setState({ status: 'anonymous', accessToken: null, user: null });
  vi.unstubAllGlobals();
});

const VND = (amount: number) => ({ amount, currency: 'VND' as const });

const APPLICATION = {
  id: 'APP1',
  applicantId: 'U1',
  applicantName: 'Nguyễn Văn An',
  status: 'PENDING',
  taxId: '0312345678',
  nationalIdNumber: '079012345678',
  bankName: 'Vietcombank',
  bankAccountNumber: '0011223344556',
  accountHolder: 'NGUYEN VAN AN',
  rejectReason: null,
  createdAt: '2026-11-20T03:00:00.000Z',
  businessLicenseUrl: 'https://kyc.test/license?sig=a',
  nationalIdUrl: 'https://kyc.test/id?sig=b',
};

const APPLICATION_ROUTES = {
  'GET /v1/platform/vendor-applications/APP1': () => json(APPLICATION),
};

describe('applications: detail, approve, reject', () => {
  it('shows the full numbers and opens KYC documents directly in a new tab', async () => {
    signInAs(['PLATFORM_STAFF']);
    fakeApi(APPLICATION_ROUTES);
    renderAt('/platform/applications?id=APP1');

    expect(await screen.findByText('079012345678')).toBeTruthy();
    expect(screen.getByText('0011223344556')).toBeTruthy();
    const license = screen.getByRole('link', { name: 'Business licence' });
    expect(license.getAttribute('href')).toBe('https://kyc.test/license?sig=a');
    expect(license.getAttribute('target')).toBe('_blank');
    expect(license.getAttribute('rel')).toContain('noopener');
  });

  it('suggests a slug from the name and validates before sending', async () => {
    signInAs(['PLATFORM_STAFF']);
    const api = fakeApi(APPLICATION_ROUTES);
    renderAt('/platform/applications?id=APP1');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const slug = await screen.findByLabelText('Shop URL slug');
    expect((slug as HTMLInputElement).value).toBe('nguyen-van-an');

    await user.clear(slug);
    await user.type(slug, 'Bad Slug');
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(/lowercase letters, digits and single hyphens only/),
    ).toBeTruthy();

    await user.clear(screen.getByLabelText('Shop name'));
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Please enter the shop name/)).toBeTruthy();
    expect(api.posts('POST /v1/platform/vendor-applications/APP1/approve')).toHaveLength(0);
  });

  it('maps 409 conflict to the slug-taken message, then succeeds with the same Idempotency-Key on retry of the same input', async () => {
    signInAs(['PLATFORM_STAFF']);
    let attempt = 0;
    const api = fakeApi({
      ...APPLICATION_ROUTES,
      'POST /v1/platform/vendor-applications/APP1/approve': () =>
        ++attempt === 1 ? err(409, 'common.error.conflict') : json({ id: 'APP1', vendorId: 'V1' }),
    });
    renderAt('/platform/applications?id=APP1');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve application' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText(/slug is already taken/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Approve application' })).toBeNull(),
    );

    const sent = api.posts('POST /v1/platform/vendor-applications/APP1/approve');
    const first = nth(sent, 0);
    const second = nth(sent, 1);
    expect(JSON.parse(await first.text())).toEqual({
      slug: 'nguyen-van-an',
      displayName: 'Nguyễn Văn An',
    });
    const key = first.headers.get('Idempotency-Key');
    expect(key).toMatch(/^[0-9A-Z]{26}$/);
    expect(second.headers.get('Idempotency-Key')).toBe(key);
  });

  it('requires a reason to reject and translates a server error', async () => {
    signInAs(['PLATFORM_STAFF']);
    const api = fakeApi({
      ...APPLICATION_ROUTES,
      'POST /v1/platform/vendor-applications/APP1/reject': () => err(403, 'common.error.forbidden'),
    });
    renderAt('/platform/applications?id=APP1');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject application' });
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Please enter a reason.')).toBeTruthy();
    expect(api.posts('POST /v1/platform/vendor-applications/APP1/reject')).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Rejection reason'), 'Blurry licence');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(
      await within(dialog).findByText(
        errorMessage('en', new ApiError(403, 'common.error.forbidden')),
      ),
    ).toBeTruthy();
    const post = nth(api.posts('POST /v1/platform/vendor-applications/APP1/reject'), 0);
    expect(JSON.parse(await post.text())).toEqual({ reason: 'Blurry licence' });
  });
});

describe('ADMIN-only gating for PLATFORM_STAFF', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Main navigation' });

  it.each(['/platform/settings', '/platform/users'])(
    '%s redirects staff to the dashboard',
    async (path) => {
      signInAs(['PLATFORM_STAFF']);
      fakeApi();
      const router = renderAt(path);
      await waitFor(() => expect(router.state.location.pathname).toBe('/platform'));
      expect(within(nav()).queryByRole('link', { name: 'Settings' })).toBeNull();
      expect(within(nav()).queryByRole('link', { name: 'Users' })).toBeNull();
    },
  );

  it('shows Settings and Users to admins', async () => {
    signInAs(['PLATFORM_ADMIN']);
    fakeApi();
    renderAt('/platform');
    expect(await within(nav()).findByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(within(nav()).getByRole('link', { name: 'Users' })).toBeTruthy();
  });

  const ORDER = {
    id: 'ORD1',
    status: 'PAID',
    grandTotal: VND(250000),
    customerName: 'Lan',
    customerEmail: 'lan@example.com',
    createdAt: '2026-11-20T03:00:00.000Z',
    subOrders: [
      {
        id: 'SUB1',
        vendorName: 'Shop A',
        status: 'PAID',
        total: VND(250000),
        items: [{ id: 'I1', productTitle: 'Áo thun', quantity: 2, lineTotal: VND(250000) }],
      },
    ],
    payments: [
      {
        id: 'P1',
        attemptNo: 1,
        provider: 'VNPAY',
        status: 'CONFIRMED',
        amount: VND(250000),
        providerTxnId: 'TX1',
      },
    ],
    ledgerEntries: [
      {
        id: 'L1',
        account: 'PLATFORM_ESCROW',
        entryType: 'ESCROW_IN',
        amount: VND(250000),
        createdAt: '2026-11-20T03:01:00.000Z',
      },
    ],
    refunds: [],
  };

  it('hides "Refund sub-order" from staff but shows payments, ledger and items', async () => {
    signInAs(['PLATFORM_STAFF']);
    fakeApi({ 'GET /v1/platform/orders/ORD1': () => json(ORDER) });
    renderAt('/platform/orders?id=ORD1');

    expect(await screen.findByText('Áo thun')).toBeTruthy();
    expect(screen.getByText('TX1', { exact: false })).toBeTruthy();
    expect(screen.getByText('Platform escrow')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refund sub-order' })).toBeNull();
  });

  it('lets an admin refund, with a reason, and shows the not-refundable reason', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const api = fakeApi({
      'GET /v1/platform/orders/ORD1': () => json(ORDER),
      'POST /v1/platform/sub-orders/SUB1/refund': () =>
        err(409, 'refund.error.not-refundable', { subOrderId: 'SUB1', reason: 'payout-released' }),
    });
    renderAt('/platform/orders?id=ORD1');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Refund sub-order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refund sub-order' });
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByText('Please enter a reason.')).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Reason'), 'Customer request');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    expect(await within(dialog).findByText(/payout was already released/)).toBeTruthy();
    const post = nth(api.posts('POST /v1/platform/sub-orders/SUB1/refund'), 0);
    expect(JSON.parse(await post.text())).toEqual({ reason: 'Customer request' });
    expect(post.headers.get('Idempotency-Key')).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('refunds: retry a FAILED provider refund', () => {
  const REFUND = {
    id: 'R1',
    subOrderId: 'SUB1',
    paymentId: 'P1',
    orderId: 'ORD1',
    vendorId: 'V1',
    amount: VND(250000),
    reason: 'Customer request',
    providerRefundId: null,
    requestedById: 'U1',
    createdAt: '2026-11-20T03:00:00.000Z',
    updatedAt: '2026-11-20T03:00:00.000Z',
  };
  const page =
    (...statuses: string[]) =>
    () =>
      json({
        items: statuses.map((status, i) => ({ ...REFUND, id: `R${i + 1}`, status })),
        nextCursor: null,
      });

  it('offers "Retry refund" to an admin only for FAILED refunds and sends it idempotently', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const api = fakeApi({
      'GET /v1/platform/refunds': page('FAILED', 'SUCCEEDED'),
      'POST /v1/platform/refunds/R1/retry': () =>
        json({ ...REFUND, id: 'R3', status: 'PENDING' }, 201),
    });
    renderAt('/platform/refunds');
    const user = ui();

    const buttons = await screen.findAllByRole('button', { name: 'Retry refund' });
    expect(buttons).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retry refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retry refund' });
    expect(within(dialog).getByText(/refused this refund/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Retry refund' }));

    await waitFor(() => expect(api.posts('POST /v1/platform/refunds/R1/retry')).toHaveLength(1));
    const post = nth(api.posts('POST /v1/platform/refunds/R1/retry'), 0);
    expect(post.headers.get('Idempotency-Key')).toMatch(/^[0-9A-Z]{26}$/);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Retry refund' })).toBeNull());
  });

  it('shows the server reason when the retry is refused', async () => {
    signInAs(['PLATFORM_ADMIN']);
    fakeApi({
      'GET /v1/platform/refunds': page('FAILED'),
      'POST /v1/platform/refunds/R1/retry': () =>
        err(409, 'refund.error.not-refundable', { subOrderId: 'SUB1', reason: 'refund-exists' }),
    });
    renderAt('/platform/refunds');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Retry refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retry refund' });
    await user.click(within(dialog).getByRole('button', { name: 'Retry refund' }));
    expect(await within(dialog).findByText(/already exists for this sub-order/)).toBeTruthy();
  });

  it('hides "Retry refund" from PLATFORM_STAFF', async () => {
    signInAs(['PLATFORM_STAFF']);
    fakeApi({ 'GET /v1/platform/refunds': page('FAILED') });
    renderAt('/platform/refunds');

    expect(await screen.findByText('Customer request')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry refund' })).toBeNull();
  });
});

const SETTINGS = {
  id: 'S1',
  commissionBps: 250,
  holdPeriodDays: 7,
  refundWindowDays: 14,
  maxCouponStack: 2,
  paymentTimeoutMinutes: 30,
  supportedCurrencies: ['VND', 'USD'],
  defaultCurrency: 'VND',
  updatedAt: '2026-11-20T03:00:00.000Z',
};

describe('settings page', () => {
  it('shows commission in percent and rejects invalid values and an unsupported default', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const api = fakeApi({ 'GET /v1/platform/settings': () => json(SETTINGS) });
    renderAt('/platform/settings');
    const user = ui();

    const commission = await screen.findByLabelText('Commission (%)');
    expect((commission as HTMLInputElement).value).toBe('2.5');

    await user.clear(commission);
    await user.type(commission, '100.5');
    await user.clear(screen.getByLabelText('Payment timeout (minutes)'));
    await user.type(screen.getByLabelText('Payment timeout (minutes)'), '4');
    await user.click(screen.getByRole('checkbox', { name: 'VND' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByText(/percentage between 0 and 100/)).toBeTruthy();
    expect(screen.getByText('Enter a whole number between 5 and 1440.')).toBeTruthy();
    expect(screen.getByText(/default currency must be one of the supported/)).toBeTruthy();
    expect(api.posts('PATCH /v1/platform/settings')).toHaveLength(0);
  });

  it('PATCHes exact basis points for a valid percentage', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const api = fakeApi({
      'GET /v1/platform/settings': () => json(SETTINGS),
      'PATCH /v1/platform/settings': () => json({ ...SETTINGS, commissionBps: 1234 }),
    });
    renderAt('/platform/settings');
    const user = ui();

    const commission = await screen.findByLabelText('Commission (%)');
    await user.clear(commission);
    await user.type(commission, '12.34');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(api.posts('PATCH /v1/platform/settings')).toHaveLength(1));
    const patch = nth(api.posts('PATCH /v1/platform/settings'), 0);
    expect(JSON.parse(await patch.text())).toMatchObject({
      commissionBps: 1234,
      holdPeriodDays: 7,
      defaultCurrency: 'VND',
    });
    expect(patch.headers.get('Idempotency-Key')).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('users page: role changes', () => {
  const USERS = {
    items: [
      { id: 'U2', email: 'ann@example.com', name: 'Ann', roles: ['PLATFORM_ADMIN'] },
      { id: 'U3', email: 'bob@example.com', name: 'Bob', roles: ['CUSTOMER'] },
    ],
    nextCursor: null,
  };

  it('maps last-platform-admin and self-demotion errors to their messages', async () => {
    signInAs(['PLATFORM_ADMIN']);
    let call = 0;
    const api = fakeApi({
      'GET /v1/platform/users': () => json(USERS),
      'DELETE /v1/platform/users/U2/roles/PLATFORM_ADMIN': () =>
        ++call === 1
          ? err(409, 'common.error.conflict', { reason: 'last-platform-admin' })
          : err(403, 'common.error.forbidden', { reason: 'self-demotion' }),
    });
    renderAt('/platform/users');
    const user = ui();

    await user.click(await screen.findByRole('button', { name: 'Remove admin' }));
    expect(await screen.findByText('The last platform admin cannot be removed.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove admin' }));
    expect(await screen.findByText(/cannot remove your own admin role/)).toBeTruthy();
    expect(api.posts('DELETE /v1/platform/users/U2/roles/PLATFORM_ADMIN')).toHaveLength(2);
  });

  it('grants a role with the role in the body and an Idempotency-Key', async () => {
    signInAs(['PLATFORM_ADMIN']);
    const api = fakeApi({
      'GET /v1/platform/users': () => json(USERS),
      'POST /v1/platform/users/U3/roles': () => json(USERS.items[1]),
    });
    renderAt('/platform/users');
    const user = ui();

    const row = (await screen.findByText('Bob')).closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Make staff' }));
    await waitFor(() => expect(api.posts('POST /v1/platform/users/U3/roles')).toHaveLength(1));
    const post = nth(api.posts('POST /v1/platform/users/U3/roles'), 0);
    expect(JSON.parse(await post.text())).toEqual({ role: 'PLATFORM_STAFF' });
    expect(post.headers.get('Idempotency-Key')).toMatch(/^[0-9A-Z]{26}$/);
  });
});

describe('dashboard', () => {
  it('shows pending counts and recent orders', async () => {
    signInAs(['PLATFORM_STAFF']);
    fakeApi({
      'GET /v1/platform/vendor-applications': () =>
        json({ items: [{ id: 'A1' }, { id: 'A2' }], nextCursor: null }),
      'GET /v1/platform/orders': () =>
        json({
          items: [
            {
              id: 'ORD9',
              status: 'PAID',
              grandTotal: VND(100000),
              subOrderCount: 1,
              customerName: 'Lan',
              customerEmail: null,
              createdAt: '2026-11-20T03:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
    });
    renderAt('/platform');

    expect(await screen.findByText('ORD9')).toBeTruthy();
    const card = screen.getByRole('link', { name: /Applications to review/ });
    await waitFor(() => expect(card.textContent).toContain('2'));
  });
});
