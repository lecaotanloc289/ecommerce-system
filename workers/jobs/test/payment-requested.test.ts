import { DomainError } from '@repo/core';
import type { CreateSessionInput, CreateSessionResult, PaymentProvider } from '@repo/payments';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers';
import { DEAD_LETTER_AT, OutboxDispatcher } from '../src/outbox/dispatcher';
import type { Providers } from '../src/payments/providers';
import {
  FakeMailer,
  eventRow,
  insertEvent,
  makeOrder,
  makePayment,
  makeUser,
  prisma,
  resetDb,
  silentLog,
} from './support/fixtures';

const EXPIRES_AT = new Date('2030-01-01T00:15:00.000Z');

/** Records createSession calls; `behaviour` decides the outcome. */
function fakeProvider(
  id: 'VNPAY' | 'STRIPE',
  behaviour: (input: CreateSessionInput) => Promise<CreateSessionResult> = (input) =>
    Promise.resolve({
      redirectUrl: `https://pay.test/${id}/${input.paymentId}`,
      providerRef: `ref-${input.paymentId}`,
      expiresAt: EXPIRES_AT,
    }),
): PaymentProvider & { calls: CreateSessionInput[] } {
  const calls: CreateSessionInput[] = [];
  return {
    id,
    currencies: id === 'VNPAY' ? ['VND'] : ['VND', 'USD'],
    calls,
    createSession(input) {
      calls.push(input);
      return behaviour(input);
    },
    verifyWebhook() {
      throw new Error('not used by the worker');
    },
    refund() {
      return Promise.reject(new Error('not used by this handler'));
    },
  };
}

function dispatcherWith(providers: Providers): OutboxDispatcher {
  const handlers = createHandlers({
    mailer: new FakeMailer(),
    providers,
    webOrigin: 'http://web.test',
    adminOrigin: 'http://admin.test',
    apiPublicUrl: 'http://api.test',
  });
  return new OutboxDispatcher(handlers, silentLog, {
    batchSize: 10,
    concurrency: 1,
    pollIntervalMs: 10,
  });
}

async function pendingPayment(
  options: {
    provider?: 'VNPAY' | 'STRIPE';
    locale?: 'VI' | 'EN';
    amount?: bigint;
    clientIp?: string | null;
    status?: 'PENDING' | 'FAILED';
  } = {},
) {
  const user = await makeUser({ primaryLocale: options.locale ?? 'VI' });
  const order = await makeOrder({ customerId: user.id, grandTotal: options.amount ?? 130_000n });
  const payment = await makePayment({
    orderId: order.id,
    provider: options.provider ?? 'VNPAY',
    amount: options.amount ?? 130_000n,
    ...(options.clientIp !== undefined ? { clientIp: options.clientIp } : {}),
    ...(options.status ? { status: options.status } : {}),
  });
  const event = await insertEvent('payment.requested', {
    orderId: order.id,
    paymentId: payment.id,
    provider: payment.provider,
    attemptNo: 1,
  });
  return { order, payment, event };
}

const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

describe('payment.requested handler', () => {
  beforeEach(() => resetDb());
  afterAll(() => prisma.$disconnect());

  it('creates a VNPay session and stores redirectUrl, expiresAt and providerRef', async () => {
    const vnpay = fakeProvider('VNPAY');
    const { order, payment, event } = await pendingPayment();

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(vnpay.calls).toEqual([
      {
        paymentId: payment.id,
        orderId: order.id,
        amount: { amount: 130_000, currency: 'VND' },
        returnUrl: 'http://api.test/v1/payments/return/vnpay',
        ipAddr: '203.0.113.7',
        locale: 'VI',
        description: `Thanh toán đơn hàng ${order.id}`,
      },
    ]);
    const row = await paymentRow(payment.id);
    expect(row).toMatchObject({
      status: 'PENDING',
      redirectUrl: `https://pay.test/VNPAY/${payment.id}`,
      providerRef: `ref-${payment.id}`,
      expiresAt: EXPIRES_AT,
    });
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('sends Stripe back to the storefront success page in the customer locale', async () => {
    const stripe = fakeProvider('STRIPE');
    const { order } = await pendingPayment({ provider: 'STRIPE', locale: 'EN', clientIp: null });

    await dispatcherWith({ STRIPE: stripe }).pollOnce();

    expect(stripe.calls[0]).toMatchObject({
      returnUrl: `http://web.test/en/order/success?orderId=${order.id}`,
      ipAddr: '127.0.0.1',
      locale: 'EN',
      description: `Payment for order ${order.id}`,
    });
  });

  it('is a no-op when the payment is no longer PENDING', async () => {
    const vnpay = fakeProvider('VNPAY');
    const { payment, event } = await pendingPayment({ status: 'FAILED' });

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(vnpay.calls).toHaveLength(0);
    expect((await paymentRow(payment.id)).redirectUrl).toBeNull();
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('does not write the session when the attempt fails while the provider call is in flight', async () => {
    let paymentId = '';
    const vnpay = fakeProvider('VNPAY', async () => {
      // A concurrent payment retry / cancel in the API fails this attempt (own transaction).
      await prisma.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } });
      return { redirectUrl: 'https://pay.test/late', providerRef: 'late', expiresAt: EXPIRES_AT };
    });
    const { payment, event } = await pendingPayment();
    paymentId = payment.id;

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    const row = await paymentRow(payment.id);
    expect(row.status).toBe('FAILED');
    expect(row.redirectUrl).toBeNull();
    expect(row.providerRef).toBeNull();
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('skips the provider for a zero-amount payment', async () => {
    const vnpay = fakeProvider('VNPAY');
    const { payment, event } = await pendingPayment({ amount: 0n });

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(vnpay.calls).toHaveLength(0);
    expect((await paymentRow(payment.id)).redirectUrl).toBeNull();
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('retries with backoff when the provider is unavailable', async () => {
    const vnpay = fakeProvider('VNPAY', () =>
      Promise.reject(new DomainError('payment.error.provider-unavailable', { provider: 'VNPAY' })),
    );
    const { payment, event } = await pendingPayment();

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    const row = await eventRow(event.id);
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('payment.error.provider-unavailable');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.nextAttemptAt).not.toEqual(DEAD_LETTER_AT);
    expect((await paymentRow(payment.id)).redirectUrl).toBeNull();
  });

  it('dead-letters when the provider refuses the request', async () => {
    const stripe = fakeProvider('STRIPE', () =>
      Promise.reject(new DomainError('common.error.validation-failed', { provider: 'STRIPE' })),
    );
    const { event } = await pendingPayment({ provider: 'STRIPE' });

    await dispatcherWith({ STRIPE: stripe }).pollOnce();

    const row = await eventRow(event.id);
    expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(row.lastError).toBe(
      'PermanentError: STRIPE refused the session: common.error.validation-failed',
    );
  });

  it('dead-letters when the provider is not configured', async () => {
    const { event } = await pendingPayment({ provider: 'STRIPE' });

    await dispatcherWith({ VNPAY: fakeProvider('VNPAY') }).pollOnce();

    const row = await eventRow(event.id);
    expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(row.lastError).toBe('PermanentError: payment provider STRIPE is not configured');
  });
});
