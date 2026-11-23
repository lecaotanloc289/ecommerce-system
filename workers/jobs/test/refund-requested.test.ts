import { DomainError } from '@repo/core';
import type { PaymentProvider, RefundInput, RefundResult } from '@repo/payments';
import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers';
import { DEAD_LETTER_AT, OutboxDispatcher } from '../src/outbox/dispatcher';
import type { Providers } from '../src/payments/providers';
import { FakeMailer, eventRow, insertEvent, prisma, resetDb, silentLog } from './support/fixtures';
import { makeMarketOrder } from './support/market';

/** Records refund calls; `behaviour` decides the outcome. */
function fakeProvider(
  behaviour: (input: RefundInput) => Promise<RefundResult> = (input) =>
    Promise.resolve({
      providerRefundId: `re-${input.refundId}`,
      status: 'SUCCEEDED',
      failureCode: null,
      raw: {},
    }),
): PaymentProvider & { calls: RefundInput[] } {
  const calls: RefundInput[] = [];
  return {
    id: 'VNPAY',
    currencies: ['VND'],
    calls,
    createSession() {
      return Promise.reject(new Error('not used by this handler'));
    },
    verifyWebhook() {
      throw new Error('not used by the worker');
    },
    refund(input) {
      calls.push(input);
      return behaviour(input);
    },
  };
}

function dispatcherWith(providers: Providers, concurrency = 1): OutboxDispatcher {
  return new OutboxDispatcher(
    createHandlers({
      mailer: new FakeMailer(),
      providers,
      webOrigin: 'http://web.test',
      adminOrigin: 'http://admin.test',
      apiPublicUrl: 'http://api.test',
    }),
    silentLog,
    { batchSize: 10, concurrency, pollIntervalMs: 10 },
  );
}

/** A paid order whose sub-orders were refunded by the API (REFUNDED + PENDING Refund rows). */
async function refundedOrder(subOrderCount = 1, refundAll = true) {
  const fixture = await makeMarketOrder({
    status: refundAll ? 'PAID' : 'PARTIALLY_REFUNDED',
    subOrders: Array.from({ length: subOrderCount }, (_, i) => ({
      status: refundAll || i === 0 ? ('REFUNDED' as const) : ('PROCESSING' as const),
    })),
    payment: { status: 'CONFIRMED', providerTxnId: 'vnp-txn-1', providerRef: '20261123101500' },
  });
  const admin = fixture.customer; // requester id only matters as `initiatedBy`
  const refunds = [];
  for (const [i, { subOrder, paid }] of fixture.subOrders.entries()) {
    if (!refundAll && i > 0) continue;
    const refund = await prisma.refund.create({
      data: {
        id: ulid(),
        subOrderId: subOrder.id,
        paymentId: fixture.payment?.id ?? '',
        amount: paid,
        currency: 'VND',
        status: 'PENDING',
        reason: 'damaged item',
        requestedById: admin.id,
      },
    });
    const event = await insertEvent('refund.requested', {
      refundId: refund.id,
      orderId: fixture.order.id,
      subOrderId: subOrder.id,
    });
    refunds.push({ refund, event });
  }
  return { ...fixture, refunds };
}

const refundRow = (id: string) => prisma.refund.findUniqueOrThrow({ where: { id } });
const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

describe('refund.requested handler', () => {
  beforeEach(() => resetDb());
  afterAll(() => prisma.$disconnect());

  it('calls the provider with the refund + payment data and marks it SUCCEEDED', async () => {
    const vnpay = fakeProvider();
    const { refunds, payment, customer } = await refundedOrder(1);
    const [{ refund, event }] = refunds as [(typeof refunds)[number]];
    const ledgerBefore = await prisma.ledgerEntry.count();

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(vnpay.calls).toEqual([
      {
        refundId: refund.id,
        paymentId: payment?.id,
        providerTxnId: 'vnp-txn-1',
        providerRef: '20261123101500',
        amount: { amount: 125_000, currency: 'VND' },
        paymentAmount: { amount: 125_000, currency: 'VND' },
        reason: 'damaged item',
        initiatedBy: customer.id,
      },
    ]);
    expect(await refundRow(refund.id)).toMatchObject({
      status: 'SUCCEEDED',
      providerRefundId: `re-${refund.id}`,
    });
    // The only sub-order is refunded and the refund covers the payment.
    expect((await paymentRow(payment?.id ?? '')).status).toBe('REFUNDED');
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('keeps the payment CONFIRMED while another sub-order is not refunded', async () => {
    const { payment, refunds } = await refundedOrder(2, false);

    await dispatcherWith({ VNPAY: fakeProvider() }).pollOnce();

    expect((await refundRow(refunds[0]?.refund.id ?? '')).status).toBe('SUCCEEDED');
    expect((await paymentRow(payment?.id ?? '')).status).toBe('CONFIRMED');
  });

  it('marks the payment REFUNDED once both sibling refunds succeed, even handled in parallel', async () => {
    const vnpay = fakeProvider();
    const { payment, refunds } = await refundedOrder(2);

    await dispatcherWith({ VNPAY: vnpay }, 2).pollOnce();

    expect(vnpay.calls).toHaveLength(2);
    for (const { refund } of refunds) expect((await refundRow(refund.id)).status).toBe('SUCCEEDED');
    expect((await paymentRow(payment?.id ?? '')).status).toBe('REFUNDED');
  });

  it('FAILED at the provider → Refund FAILED, no ledger change, payment untouched', async () => {
    const vnpay = fakeProvider(() =>
      Promise.resolve({ providerRefundId: null, status: 'FAILED', failureCode: '94', raw: {} }),
    );
    const { refunds, payment } = await refundedOrder(1);
    const ledgerBefore = await prisma.ledgerEntry.findMany();

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    const { refund, event } = refunds[0] ?? { refund: { id: '' }, event: { id: '' } };
    expect(await refundRow(refund.id)).toMatchObject({ status: 'FAILED', providerRefundId: null });
    expect(await prisma.ledgerEntry.findMany()).toEqual(ledgerBefore);
    expect((await paymentRow(payment?.id ?? '')).status).toBe('CONFIRMED');
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('PENDING at the provider → stays PENDING with providerRefundId; redelivery does not call again', async () => {
    const vnpay = fakeProvider((input) =>
      Promise.resolve({
        providerRefundId: `re-${input.refundId}`,
        status: 'PENDING',
        failureCode: null,
        raw: {},
      }),
    );
    const { refunds, order } = await refundedOrder(1);
    const { refund } = refunds[0] ?? { refund: { id: '', subOrderId: '' } };

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();
    expect(await refundRow(refund.id)).toMatchObject({
      status: 'PENDING',
      providerRefundId: `re-${refund.id}`,
    });

    await insertEvent('refund.requested', {
      refundId: refund.id,
      orderId: order.id,
      subOrderId: refund.subOrderId,
    });
    await dispatcherWith({ VNPAY: vnpay }).pollOnce();
    expect(vnpay.calls).toHaveLength(1);
  });

  it('PENDING without a provider reference (VNPay duplicate request) leaves the row untouched', async () => {
    const vnpay = fakeProvider(() =>
      Promise.resolve({ providerRefundId: null, status: 'PENDING', failureCode: '94', raw: {} }),
    );
    const { refunds } = await refundedOrder(1);
    const { refund, event } = refunds[0] ?? { refund: { id: '' }, event: { id: '' } };

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(await refundRow(refund.id)).toMatchObject({ status: 'PENDING', providerRefundId: null });
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('is idempotent: a redelivered event for a SUCCEEDED refund does not call the provider', async () => {
    const vnpay = fakeProvider();
    const { refunds, order } = await refundedOrder(1);
    const { refund } = refunds[0] ?? { refund: { id: '', subOrderId: '' } };
    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    const again = await insertEvent('refund.requested', {
      refundId: refund.id,
      orderId: order.id,
      subOrderId: refund.subOrderId,
    });
    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    expect(vnpay.calls).toHaveLength(1);
    expect((await eventRow(again.id)).processedAt).not.toBeNull();
  });

  it('retries when the provider is unavailable (refund stays PENDING)', async () => {
    const vnpay = fakeProvider(() =>
      Promise.reject(new DomainError('payment.error.provider-unavailable', { provider: 'VNPAY' })),
    );
    const { refunds } = await refundedOrder(1);
    const { refund, event } = refunds[0] ?? { refund: { id: '' }, event: { id: '' } };

    await dispatcherWith({ VNPAY: vnpay }).pollOnce();

    const row = await eventRow(event.id);
    expect(row.processedAt).toBeNull();
    expect(row.nextAttemptAt).not.toEqual(DEAD_LETTER_AT);
    expect(row.lastError).toContain('payment.error.provider-unavailable');
    expect((await refundRow(refund.id)).status).toBe('PENDING');
  });

  it('dead-letters a refused request, an unconfigured provider and a mismatched payload', async () => {
    const refused = fakeProvider(() =>
      Promise.reject(new DomainError('common.error.validation-failed', { provider: 'VNPAY' })),
    );
    const first = await refundedOrder(1);
    await dispatcherWith({ VNPAY: refused }).pollOnce();
    const firstEvent = await eventRow(first.refunds[0]?.event.id ?? '');
    expect(firstEvent.nextAttemptAt).toEqual(DEAD_LETTER_AT);
    expect(firstEvent.lastError).toBe(
      'PermanentError: VNPAY refused the refund: common.error.validation-failed',
    );

    await resetDb();
    const second = await refundedOrder(1);
    await dispatcherWith({}).pollOnce();
    expect((await eventRow(second.refunds[0]?.event.id ?? '')).lastError).toBe(
      'PermanentError: payment provider VNPAY is not configured',
    );

    const foreign = await insertEvent('refund.requested', {
      refundId: second.refunds[0]?.refund.id ?? '',
      orderId: ulid(),
      subOrderId: second.subOrders[0]?.subOrder.id ?? '',
    });
    await dispatcherWith({ VNPAY: fakeProvider() }).pollOnce();
    expect((await eventRow(foreign.id)).nextAttemptAt).toEqual(DEAD_LETTER_AT);
  });
});
