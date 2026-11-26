import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubOrderStatus } from '@repo/core';
import { authStore } from '@/auth/session';
import { useLocaleStore } from '@/i18n/use-locale';
import { actionFor, OrderActions } from '@/pages/vendor/order-actions';
import { json, makeUser } from '../fixtures';
import { stubApi } from './fake-api';

const ORDER_ID = '01JC0000000000000000000SO1';

function renderActions(status: SubOrderStatus, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <OrderActions orderId={ORDER_ID} status={status} />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
  authStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: makeUser(['VENDOR_OWNER']),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('actionFor', () => {
  it.each<[SubOrderStatus, string | null]>([
    ['PAID', 'accept'],
    ['PROCESSING', 'ship'],
    ['SHIPPED', 'deliver'],
    ['DELIVERED', null],
    ['COMPLETED', null],
    ['REFUNDED', null],
    ['CANCELLED', null],
    ['AWAITING_PAYMENT', null],
  ])('%s → %s', (status, action) => {
    expect(actionFor(status)).toBe(action);
  });
});

describe('<OrderActions>', () => {
  it.each([
    ['PAID', 'Accept'],
    ['PROCESSING', 'Ship'],
    ['SHIPPED', 'Mark delivered'],
  ] as const)('%s shows exactly the "%s" button', (status, label) => {
    renderActions(status);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it.each(['DELIVERED', 'COMPLETED', 'REFUNDED'] as const)('%s offers no action', (status) => {
    renderActions(status);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('accept sends POST with an Idempotency-Key', async () => {
    const fake = stubApi({
      [`POST /v1/vendor/sub-orders/${ORDER_ID}/accept`]: () => json({}),
    });
    renderActions('PAID');
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(fake.calls[0]?.headers.get('Idempotency-Key')).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('ship needs carrier + tracking, then posts them', async () => {
    const fake = stubApi({
      [`POST /v1/vendor/sub-orders/${ORDER_ID}/ship`]: () => json({}),
    });
    renderActions('PROCESSING');
    await userEvent.click(screen.getByRole('button', { name: 'Ship' }));

    await userEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));
    expect(fake.calls).toHaveLength(0); // blank form is rejected client-side

    await userEvent.type(screen.getByLabelText('Carrier'), 'GHN');
    await userEvent.type(screen.getByLabelText('Tracking number'), 'GHN123');
    await userEvent.click(screen.getByRole('button', { name: 'Mark as shipped' }));

    await waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(await fake.calls[0]?.json()).toEqual({ carrier: 'GHN', trackingNumber: 'GHN123' });
    expect(fake.calls[0]?.headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('409 invalid-status-transition shows the message and refetches orders', async () => {
    stubApi({
      [`POST /v1/vendor/sub-orders/${ORDER_ID}/accept`]: () =>
        json(
          {
            errorCode: 'order.error.invalid-status-transition',
            params: { from: 'PROCESSING', to: 'PROCESSING' },
          },
          409,
        ),
    });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderActions('PAID', client);
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(
      await screen.findByText('This order can’t be updated in its current state.'),
    ).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vendor', 'orders'] });
  });
});
