import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@repo/db';
import { formatMoney } from '@repo/i18n';
import { AccountManager, leaseKey } from '../src/accounts.js';
import { MessageSender, recipientKey } from '../src/messages.js';
import { FakeGateway, FakeSession, fakeCredentials } from './fake-gateway.js';
import {
  cipher,
  logger,
  makeAccount,
  makeMessage,
  makeShop,
  makeSubOrder,
  makeTemplate,
  newRedis,
  resetAll,
  testEnv,
} from './fixtures.js';

let redis: Redis;
let clock: number;

beforeAll(() => {
  redis = newRedis();
});
afterAll(async () => {
  await redis.quit();
});
beforeEach(async () => {
  await resetAll(redis);
  clock = Date.now();
});

/** A shop with a held session; the customer phone 0901234567 is on Zalo as `cust-1`. */
async function heldShop() {
  const shop = await makeShop('Shop A');
  const creds = fakeCredentials('a');
  const account = await makeAccount({ vendorId: shop.vendor.id, credentials: creds });
  const session = new FakeSession('uid-shop', creds);
  session.phones.set('0901234567', 'cust-1');
  const gateway = new FakeGateway();
  gateway.sessions.set(creds.imei, session);
  const accounts = new AccountManager({
    redis,
    gateway,
    cipher,
    logger,
    env: testEnv,
    instanceId: 'replica-1',
    now: () => clock,
  });
  await accounts.sync();
  const sender = new MessageSender({ redis, accounts, logger, env: testEnv, now: () => clock });
  return { ...shop, account, session, accounts, sender };
}

describe('MessageSender', () => {
  it('renders the template and sends it to the customer found by phone', async () => {
    const { vendor, variant, session, sender, account } = await heldShop();
    await makeTemplate(
      vendor.id,
      'ORDER_SHIPPED',
      'Chào {{customerName}}, đơn {{orderCode}} của {{shopName}} ({{total}}) đã giao cho {{carrier}} - {{trackingNumber}}\n{{itemList}}',
    );
    const { order, subOrder } = await makeSubOrder({
      vendorId: vendor.id,
      variantId: variant.id,
      status: 'SHIPPED',
      carrier: 'GHN',
      trackingNumber: 'GHN123',
    });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_SHIPPED',
    });

    await sender.tick();

    const code = `#${order.id.slice(-8)}`;
    // 200 000 + 30 000 − 15 000 − 5 000 = 210 000 ₫ (formatted for the customer's locale, vi)
    const total = formatMoney({ amount: 210_000, currency: 'VND' }, 'vi');
    const expected = `Chào Nguyễn An, đơn ${code} của Shop A (${total}) đã giao cho GHN - GHN123\n• Áo thun x2`;
    expect(session.sent).toEqual([{ uid: 'cust-1', text: expected }]);
    const row = await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({
      status: 'SENT',
      renderedBody: expected,
      zaloMessageId: '1001',
      lockedUntil: null,
    });
    expect(row.sentAt).not.toBeNull();
    expect(await redis.get(recipientKey(account.id, '0901234567'))).toBe('cust-1');
  });

  it('paces one account: one Zalo call per ZALO_SEND_MIN_INTERVAL_MS', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'Đã nhận tiền {{orderCode}}');
    for (let i = 0; i < 2; i += 1) {
      const { subOrder } = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
      await makeMessage({ vendorId: vendor.id, subOrderId: subOrder.id, event: 'ORDER_PAID' });
    }

    await sender.tick();
    await sender.tick();
    expect(session.sent).toHaveLength(1);

    clock += testEnv.ZALO_SEND_MIN_INTERVAL_MS;
    await sender.tick();
    expect(session.sent).toHaveLength(2);
  });

  it('skips without calling Zalo: disabled template, invalid phone, care after a refund', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'x', false);
    await makeTemplate(vendor.id, 'ORDER_SHIPPED', 'x');
    await makeTemplate(vendor.id, 'AFTER_DELIVERY', 'x');
    const a = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    const b = await makeSubOrder({
      vendorId: vendor.id,
      variantId: variant.id,
      phone: '+1 415 555 0100',
    });
    const c = await makeSubOrder({
      vendorId: vendor.id,
      variantId: variant.id,
      status: 'REFUNDED',
    });
    const disabled = await makeMessage({
      vendorId: vendor.id,
      subOrderId: a.subOrder.id,
      event: 'ORDER_PAID',
    });
    const foreign = await makeMessage({
      vendorId: vendor.id,
      subOrderId: b.subOrder.id,
      event: 'ORDER_SHIPPED',
    });
    const care = await makeMessage({
      vendorId: vendor.id,
      subOrderId: c.subOrder.id,
      event: 'AFTER_DELIVERY',
    });

    for (let i = 0; i < 3; i += 1) await sender.tick();

    const rows = await prisma.zaloMessage.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.id, r.status, r.skipReason])).toEqual([
      [disabled.id, 'SKIPPED', 'template-disabled'],
      [foreign.id, 'SKIPPED', 'invalid-phone'],
      [care.id, 'SKIPPED', 'order-status-changed'],
    ]);
    expect(session.lookups).toEqual([]);
  });

  it('skips a customer who is not on Zalo and caches the miss', async () => {
    const { vendor, variant, session, sender, account } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'x');
    const { subOrder } = await makeSubOrder({
      vendorId: vendor.id,
      variantId: variant.id,
      phone: '0912000000',
    });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_PAID',
    });

    await sender.tick();

    const row = await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: 'SKIPPED', skipReason: 'recipient-not-found' });
    expect(session.lookups).toEqual(['0912000000']);
    expect(await redis.get(recipientKey(account.id, '0912000000'))).toBe('');
  });

  it('retries a failed send with backoff, then FAILS after the max attempts', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'x');
    const { subOrder } = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_PAID',
    });
    session.sendError = new Error('zalo 500');

    await sender.tick();
    let row = await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Error: zalo 500' });
    expect(row.nextAttemptAt.getTime()).toBe(clock + 60_000);

    // Not due yet (next_attempt_at is in the future for the DB clock too).
    clock += testEnv.ZALO_SEND_MIN_INTERVAL_MS;
    await sender.tick();
    expect(
      (await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } })).attempts,
    ).toBe(1);

    for (const attempts of [2, 3]) {
      await prisma.zaloMessage.update({
        where: { id: message.id },
        data: { nextAttemptAt: new Date(0) },
      });
      clock += testEnv.ZALO_SEND_MIN_INTERVAL_MS;
      await sender.tick();
      row = await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(row.attempts).toBe(attempts);
    }
    expect(row.status).toBe('FAILED');
  });

  it('does not send before scheduledAt (care message delay)', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'AFTER_DELIVERY', 'Cảm ơn {{customerName}}!');
    const { subOrder } = await makeSubOrder({
      vendorId: vendor.id,
      variantId: variant.id,
      status: 'DELIVERED',
    });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'AFTER_DELIVERY',
      scheduledAt: new Date(Date.now() + 3_600_000),
    });

    await sender.tick();
    expect(session.sent).toHaveLength(0);

    await prisma.zaloMessage.update({
      where: { id: message.id },
      data: { scheduledAt: new Date(Date.now() - 1_000) },
    });
    await sender.tick();
    expect(session.sent).toEqual([{ uid: 'cust-1', text: 'Cảm ơn Nguyễn An!' }]);
  });
});

describe('MessageSender guards', () => {
  it('skips a suspended shop and stale messages of a cancelled order, but still sends the cancel', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'paid');
    await makeTemplate(vendor.id, 'ORDER_CANCELLED', 'huỷ {{orderCode}}');
    const { order, subOrder } = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    await prisma.subOrder.update({ where: { id: subOrder.id }, data: { status: 'CANCELLED' } });
    const stale = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_PAID',
    });
    const cancel = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_CANCELLED',
    });

    await sender.tick(); // stale skipped (no Zalo call → no pacing)
    await sender.tick(); // cancel sent
    expect(session.sent).toEqual([{ uid: 'cust-1', text: `huỷ #${order.id.slice(-8)}` }]);
    expect(await prisma.zaloMessage.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'order-status-changed',
    });
    expect((await prisma.zaloMessage.findUniqueOrThrow({ where: { id: cancel.id } })).status).toBe(
      'SENT',
    );

    await prisma.vendor.update({ where: { id: vendor.id }, data: { status: 'SUSPENDED' } });
    const other = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    const blocked = await makeMessage({
      vendorId: vendor.id,
      subOrderId: other.subOrder.id,
      event: 'ORDER_PAID',
    });
    clock += testEnv.ZALO_SEND_MIN_INTERVAL_MS;
    await sender.tick();
    expect(await prisma.zaloMessage.findUniqueOrThrow({ where: { id: blocked.id } })).toMatchObject(
      {
        status: 'SKIPPED',
        skipReason: 'vendor-inactive',
      },
    );
    expect(session.sent).toHaveLength(1);
  });

  it('hands the row back without spending an attempt when the lease was taken over', async () => {
    const { vendor, variant, session, sender, account } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'x');
    const { subOrder } = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_PAID',
    });
    await redis.set(leaseKey(account.id), 'replica-2');

    await sender.tick();

    expect(session.sent).toHaveLength(0);
    expect(await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject(
      {
        status: 'PENDING',
        attempts: 0,
        lockedUntil: null,
      },
    );
  });

  it('times out a hung send and schedules a retry', async () => {
    const { vendor, variant, session, sender } = await heldShop();
    await makeTemplate(vendor.id, 'ORDER_PAID', 'x');
    const { subOrder } = await makeSubOrder({ vendorId: vendor.id, variantId: variant.id });
    const message = await makeMessage({
      vendorId: vendor.id,
      subOrderId: subOrder.id,
      event: 'ORDER_PAID',
    });
    session.hangSend = true;

    await sender.tick();

    const row = await prisma.zaloMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.lastError).toContain('ZaloTimeoutError');
  });
});

describe('MessageSender.housekeeping', () => {
  it('reclaims expired SENDING claims and skips undeliverable rows', async () => {
    const a = await makeShop('A');
    const b = await makeShop('B');
    await makeAccount({
      vendorId: b.vendor.id,
      credentials: fakeCredentials('b'),
      status: 'DISCONNECTED',
      zaloUid: 'uid-b',
    });
    const stuck = await makeMessage({
      vendorId: a.vendor.id,
      subOrderId: (await makeSubOrder({ vendorId: a.vendor.id, variantId: a.variant.id })).subOrder
        .id,
      event: 'ORDER_PAID',
    });
    await prisma.zaloMessage.update({
      where: { id: stuck.id },
      data: { status: 'SENDING', lockedUntil: new Date(Date.now() - 1_000) },
    });
    const disconnected = await makeMessage({
      vendorId: b.vendor.id,
      subOrderId: (await makeSubOrder({ vendorId: b.vendor.id, variantId: b.variant.id })).subOrder
        .id,
      event: 'ORDER_PAID',
    });
    const old = await makeMessage({
      vendorId: a.vendor.id,
      subOrderId: (await makeSubOrder({ vendorId: a.vendor.id, variantId: a.variant.id })).subOrder
        .id,
      event: 'ORDER_PAID',
      scheduledAt: new Date(Date.now() - 25 * 3_600_000),
    });
    const fresh = await makeMessage({
      vendorId: a.vendor.id,
      subOrderId: (await makeSubOrder({ vendorId: a.vendor.id, variantId: a.variant.id })).subOrder
        .id,
      event: 'ORDER_PAID',
    });

    const sender = new MessageSender({
      redis,
      accounts: new AccountManager({
        redis,
        gateway: new FakeGateway(),
        cipher,
        logger,
        env: testEnv,
        instanceId: 'r',
      }),
      logger,
      env: testEnv,
    });
    await sender.housekeeping();

    const byId = new Map((await prisma.zaloMessage.findMany()).map((r) => [r.id, r]));
    expect(byId.get(stuck.id)).toMatchObject({ status: 'PENDING', lockedUntil: null });
    expect(byId.get(disconnected.id)).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'account-unavailable',
    });
    expect(byId.get(old.id)).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'account-unavailable',
    });
    expect(byId.get(fresh.id)?.status).toBe('PENDING');
  });
});
