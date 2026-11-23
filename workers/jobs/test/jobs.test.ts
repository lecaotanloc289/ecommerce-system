import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { autoCompleteSubOrders, completeSubOrder } from '../src/jobs/auto-complete-sub-orders';
import { expireUnpaidOrders } from '../src/jobs/expire-unpaid-orders';
import { pruneOutbox } from '../src/jobs/outbox-retention';
import { releasePayout, releasePayouts } from '../src/jobs/release-payouts';
import { DEAD_LETTER_AT } from '../src/outbox/dispatcher';
import { insertEvent, prisma, resetDb, silentLog } from './support/fixtures';
import {
  DAY,
  groupSums,
  ledgerOf,
  makeMarketOrder,
  makeSettings,
  outboxOf,
  setSubOrderTime,
} from './support/market';

const ctx = { log: silentLog, batchSize: 2 };
const subOrderRow = (id: string) => prisma.subOrder.findUniqueOrThrow({ where: { id } });
const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  await makeSettings({ holdPeriodDays: 7, refundWindowDays: 7 });
});
afterAll(() => prisma.$disconnect());

describe('expire-unpaid-orders', () => {
  it('cancels an overdue order exactly like cancelOrder (PAYMENT_EXPIRED)', async () => {
    const { order, subOrders, payment, customer } = await makeMarketOrder({
      status: 'AWAITING_PAYMENT',
      deadlineInSeconds: -60,
      subOrders: [
        { status: 'AWAITING_PAYMENT', quantity: 2, stockOnHand: 10, stockReserved: 3 },
        { status: 'AWAITING_PAYMENT', quantity: 1, stockOnHand: 5, stockReserved: 1 },
      ],
      payment: { status: 'PENDING' },
    });
    const coupon = await prisma.coupon.create({
      data: {
        id: ulid(),
        scope: 'PLATFORM',
        code: 'WELCOME10',
        discountType: 'PERCENT',
        discountValue: 1000n,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    await prisma.couponRedemption.create({
      data: {
        id: ulid(),
        couponId: coupon.id,
        userId: customer.id,
        orderId: order.id,
        discountAmount: 1000n,
        currency: 'VND',
      },
    });
    const fresh = await makeMarketOrder({
      status: 'AWAITING_PAYMENT',
      deadlineInSeconds: 600,
      subOrders: [{ status: 'AWAITING_PAYMENT' }],
    });

    const summary = await expireUnpaidOrders(ctx);

    expect(summary).toEqual({ candidates: 1, done: 1, skipped: 0, failed: 0 });
    expect((await orderRow(order.id)).status).toBe('CANCELLED');
    for (const { subOrder } of subOrders) {
      const row = await subOrderRow(subOrder.id);
      expect(row.status).toBe('CANCELLED');
      expect(row.cancelledAt).not.toBeNull();
    }
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: subOrders.map((s) => s.variant.id) } },
      orderBy: { stockOnHand: 'desc' },
    });
    expect(variants.map((v) => [v.stockOnHand, v.stockReserved])).toEqual([
      [10, 1],
      [5, 0],
    ]);
    expect(await prisma.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment?.id ?? '' } })).status,
    ).toBe('FAILED');
    const events = await outboxOf('order.cancelled');
    expect(events.map((e) => e.payload)).toEqual([
      { orderId: order.id, customerId: customer.id, reason: 'PAYMENT_EXPIRED' },
    ]);
    expect((await orderRow(fresh.order.id)).status).toBe('AWAITING_PAYMENT');

    // Second run: nothing left to expire.
    expect(await expireUnpaidOrders(ctx)).toEqual({
      candidates: 0,
      done: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('an aborted run (shutdown) stops before touching the next row', async () => {
    const { order } = await makeMarketOrder({
      status: 'AWAITING_PAYMENT',
      deadlineInSeconds: -60,
      subOrders: [{ status: 'AWAITING_PAYMENT' }],
    });
    const stopped = new AbortController();
    stopped.abort();

    expect(await expireUnpaidOrders({ ...ctx, signal: stopped.signal })).toMatchObject({
      candidates: 0,
    });
    expect((await orderRow(order.id)).status).toBe('AWAITING_PAYMENT');
  });

  it('skips an overdue order whose sub-orders are no longer all unpaid', async () => {
    const { order } = await makeMarketOrder({
      status: 'AWAITING_PAYMENT',
      deadlineInSeconds: -60,
      subOrders: [{ status: 'AWAITING_PAYMENT' }, { status: 'PAID' }],
    });

    expect(await expireUnpaidOrders(ctx)).toMatchObject({ candidates: 1, skipped: 1, done: 0 });
    expect((await orderRow(order.id)).status).toBe('AWAITING_PAYMENT');
    expect(await outboxOf('order.cancelled')).toHaveLength(0);
  });

  it('two concurrent runs cancel once', async () => {
    await makeMarketOrder({
      status: 'AWAITING_PAYMENT',
      deadlineInSeconds: -60,
      subOrders: [{ status: 'AWAITING_PAYMENT', quantity: 2, stockReserved: 2 }],
    });

    const [a, b] = await Promise.all([expireUnpaidOrders(ctx), expireUnpaidOrders(ctx)]);

    expect(a.done + b.done).toBe(1);
    expect(await outboxOf('order.cancelled')).toHaveLength(1);
    expect((await prisma.productVariant.findFirstOrThrow()).stockReserved).toBe(0);
  });
});

describe('auto-complete-sub-orders', () => {
  it('completes DELIVERED sub-orders past the refund window and emits sub-order.completed', async () => {
    const { order, subOrders } = await makeMarketOrder({
      status: 'PAID',
      subOrders: [{ status: 'DELIVERED' }, { status: 'DELIVERED' }],
      payment: { status: 'CONFIRMED', providerTxnId: 'txn-1' },
    });
    const [due, notYet] = subOrders;
    if (!due || !notYet) throw new Error('fixture');
    await setSubOrderTime(due.subOrder.id, 'delivered_at', -7 * DAY - 3600);
    await setSubOrderTime(notYet.subOrder.id, 'delivered_at', -7 * DAY + 3600);

    expect(await autoCompleteSubOrders(ctx)).toMatchObject({ candidates: 1, done: 1 });

    const completed = await subOrderRow(due.subOrder.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();
    expect((await subOrderRow(notYet.subOrder.id)).status).toBe('DELIVERED');
    expect((await orderRow(order.id)).status).toBe('PAID'); // one sub-order still open
    expect((await outboxOf('sub-order.completed')).map((e) => e.payload)).toEqual([
      { orderId: order.id, subOrderId: due.subOrder.id, vendorId: due.vendor.id },
    ]);

    // Second sub-order completes → order COMPLETED.
    await setSubOrderTime(notYet.subOrder.id, 'delivered_at', -8 * DAY);
    await autoCompleteSubOrders(ctx);
    expect((await orderRow(order.id)).status).toBe('COMPLETED');
  });

  it('boundary: not due 1s before deliveredAt + refundWindowDays, due 1ms after (one DB clock)', async () => {
    const { order, subOrders } = await makeMarketOrder({
      status: 'PAID',
      subOrders: [{ status: 'DELIVERED' }],
    });
    const id = subOrders[0]?.subOrder.id ?? '';
    // Inside one transaction `now()` is fixed, so the boundary is exact — no sleeps.
    const at = (offsetSeconds: number) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE sub_orders
          SET delivered_at = (now() AT TIME ZONE 'UTC') - interval '7 days'
            + make_interval(secs => ${offsetSeconds}::float8)
          WHERE id = ${id}`;
        return completeSubOrder(tx, { id, orderId: order.id }, 7);
      });

    expect(await at(1)).toBe('skipped');
    expect((await subOrderRow(id)).status).toBe('DELIVERED');
    // Not exactly 0: the column is timestamp(3) while now() has µs, so "now − 7 d" may be stored
    // rounded UP by < 0.5 ms; 1 ms past the window is the tightest representable "due".
    expect(await at(-0.001)).toBe('done');
    expect((await subOrderRow(id)).status).toBe('COMPLETED');
  });
});

describe('release-payouts', () => {
  async function completedOrder(
    specs: Parameters<typeof makeMarketOrder>[0]['subOrders'],
    completedSecondsAgo = 8 * DAY,
  ) {
    const fixture = await makeMarketOrder({
      status: 'COMPLETED',
      subOrders: specs,
      payment: { status: 'CONFIRMED', providerTxnId: 'txn-1' },
    });
    for (const { subOrder } of fixture.subOrders) {
      await setSubOrderTime(subOrder.id, 'completed_at', -completedSecondsAgo);
    }
    return fixture;
  }

  async function expectBooksBalance() {
    const entries = await ledgerOf();
    for (const sum of groupSums(entries)) expect(sum).toBe(0n);
    for (const wallet of await prisma.wallet.findMany()) {
      const credited = entries
        .filter((e) => e.account === 'VENDOR_WALLET' && e.vendorId === wallet.vendorId)
        .reduce((s, e) => s + e.amount, 0n);
      expect(wallet.balanceAmount).toBe(credited);
    }
  }

  it('pays net into the wallet with the D7 ledger group and emits payout.released', async () => {
    const { order, subOrders } = await completedOrder([
      // paid = 100 000 + 30 000 − 5 000 − 20 000 = 105 000; net = 125 000 − 9 500 = 115 500;
      // revenue = 9 500 − 20 000 = −10 500 (platform coupon bigger than its commission).
      { status: 'COMPLETED', platformDiscount: 20_000n },
    ]);
    const { subOrder, vendor } = subOrders[0] ?? { subOrder: null, vendor: null };
    if (!subOrder || !vendor) throw new Error('fixture');

    expect(await releasePayouts(ctx)).toMatchObject({ candidates: 1, done: 1 });

    expect((await subOrderRow(subOrder.id)).payoutReleasedAt).not.toBeNull();
    const entries = await ledgerOf({ subOrderId: subOrder.id });
    expect(
      entries
        .map((e) => [e.account, e.entryType, e.amount, e.vendorId, e.orderId])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['PLATFORM_ESCROW', 'PAYOUT_OUT', -105_000n, null, order.id],
      ['PLATFORM_REVENUE', 'PAYOUT_OUT', -10_500n, null, order.id],
      ['VENDOR_WALLET', 'PAYOUT_OUT', 115_500n, vendor.id, order.id],
    ]);
    expect(new Set(entries.map((e) => e.txnGroupId)).size).toBe(1);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { vendorId: vendor.id } })).balanceAmount,
    ).toBe(115_500n);
    expect((await outboxOf('payout.released')).map((e) => e.payload)).toEqual([
      { subOrderId: subOrder.id, vendorId: vendor.id },
    ]);
    await expectBooksBalance();
  });

  it('hold-period boundary: not paid 1s before completedAt + holdPeriodDays, paid 1s after', async () => {
    const { order, subOrders } = await completedOrder([{ status: 'COMPLETED' }]);
    const id = subOrders[0]?.subOrder.id ?? '';
    const at = (offsetSeconds: number) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE sub_orders
          SET completed_at = (now() AT TIME ZONE 'UTC') - interval '7 days'
            + make_interval(secs => ${offsetSeconds}::float8)
          WHERE id = ${id}`;
        return releasePayout(tx, { id, orderId: order.id }, 7, silentLog);
      });

    expect(await at(1)).toBe('skipped'); // 7 days − 1 s ago
    expect((await subOrderRow(id)).payoutReleasedAt).toBeNull();
    expect(await ledgerOf()).toHaveLength(0);
    expect(await at(-1)).toBe('done'); // 7 days + 1 s ago
    expect((await subOrderRow(id)).payoutReleasedAt).not.toBeNull();
  });

  it('selects by the hold period (DB clock) and uses PlatformSettings', async () => {
    const { subOrders } = await completedOrder([{ status: 'COMPLETED' }], 6 * DAY);
    expect(await releasePayouts(ctx)).toMatchObject({ candidates: 0 });

    await prisma.platformSettings.updateMany({ data: { holdPeriodDays: 5 } });
    expect(await releasePayouts(ctx)).toMatchObject({ candidates: 1, done: 1 });
    expect((await subOrderRow(subOrders[0]?.subOrder.id ?? '')).payoutReleasedAt).not.toBeNull();
  });

  it('running twice, or two runs concurrently, pays each sub-order once', async () => {
    await completedOrder([{ status: 'COMPLETED' }, { status: 'COMPLETED' }]);
    await completedOrder([{ status: 'COMPLETED' }]);

    const [a, b] = await Promise.all([releasePayouts(ctx), releasePayouts(ctx)]);
    const again = await releasePayouts(ctx);

    expect(a.done + b.done).toBe(3);
    expect(a.failed + b.failed).toBe(0);
    expect(again).toMatchObject({ candidates: 0, done: 0 });
    expect(await outboxOf('payout.released')).toHaveLength(3);
    expect((await ledgerOf()).filter((e) => e.account === 'VENDOR_WALLET')).toHaveLength(3);
    for (const wallet of await prisma.wallet.findMany()) {
      expect(wallet.balanceAmount).toBe(115_500n);
    }
    await expectBooksBalance();
  });

  it('does not pay out a sub-order with a PENDING or SUCCEEDED refund (FAILED does not block)', async () => {
    const { subOrders, payment, customer } = await completedOrder([
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
    ]);
    const refund = (subOrderId: string, status: 'PENDING' | 'SUCCEEDED' | 'FAILED') =>
      prisma.refund.create({
        data: {
          id: ulid(),
          subOrderId,
          paymentId: payment?.id ?? '',
          amount: 125_000n,
          currency: 'VND',
          status,
          reason: 'test',
          requestedById: customer.id,
        },
      });
    const [pending, succeeded, failed] = subOrders.map((s) => s.subOrder.id);
    await refund(pending ?? '', 'PENDING');
    await refund(succeeded ?? '', 'SUCCEEDED');
    await refund(failed ?? '', 'FAILED');

    expect(await releasePayouts(ctx)).toMatchObject({ candidates: 1, done: 1 });
    expect((await subOrderRow(pending ?? '')).payoutReleasedAt).toBeNull();
    expect((await subOrderRow(succeeded ?? '')).payoutReleasedAt).toBeNull();
    expect((await subOrderRow(failed ?? '')).payoutReleasedAt).not.toBeNull();
  });

  it('skips (and logs) a wallet in another currency; never pays REFUNDED sub-orders', async () => {
    const { subOrders } = await completedOrder([
      { status: 'COMPLETED', walletCurrency: 'USD' },
      { status: 'REFUNDED' },
    ]);

    expect(await releasePayouts(ctx)).toMatchObject({ candidates: 1, skipped: 1, done: 0 });
    for (const { subOrder } of subOrders) {
      expect((await subOrderRow(subOrder.id)).payoutReleasedAt).toBeNull();
    }
    expect(await ledgerOf()).toHaveLength(0);
    expect(await outboxOf('payout.released')).toHaveLength(0);
  });
});

describe('outbox-retention', () => {
  it('deletes processed rows older than N days, keeps recent, pending and dead-lettered ones', async () => {
    const old = new Date(Date.now() - 40 * DAY * 1000);
    const recent = new Date(Date.now() - 5 * DAY * 1000);
    const processedOld = await insertEvent('order.paid', {});
    const processedOld2 = await insertEvent('order.paid', {});
    const processedOld3 = await insertEvent('order.paid', {});
    const processedRecent = await insertEvent('order.paid', {});
    const deadLetter = await insertEvent('order.paid', {}, { createdAt: old });
    const pending = await insertEvent('order.paid', {}, { createdAt: old });
    await prisma.outboxEvent.updateMany({
      where: { id: { in: [processedOld.id, processedOld2.id, processedOld3.id] } },
      data: { processedAt: old },
    });
    await prisma.outboxEvent.update({
      where: { id: processedRecent.id },
      data: { processedAt: recent },
    });
    await prisma.outboxEvent.update({
      where: { id: deadLetter.id },
      data: { nextAttemptAt: DEAD_LETTER_AT, attempts: 10 },
    });

    // batchSize 2 → several DELETE rounds.
    expect(await pruneOutbox({ ...ctx, retentionDays: 30 })).toMatchObject({ done: 3 });

    const left = await prisma.outboxEvent.findMany({ select: { id: true } });
    expect(left.map((r) => r.id).sort()).toEqual(
      [processedRecent.id, deadLetter.id, pending.id].sort(),
    );
  });
});
