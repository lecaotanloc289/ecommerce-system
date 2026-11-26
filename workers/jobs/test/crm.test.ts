import { deriveUnsubscribeToken, hashUnsubscribeToken, type CrmSkipReason } from '@repo/core';
import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { renderCrmEmail } from '../src/email/crm-templates';
import { createHandlers } from '../src/handlers';
import {
  CRM_DISPATCH_MAX_PER_RUN,
  dispatchDueCrmMessages,
  startDueCampaigns,
} from '../src/jobs/crm';
import { DEAD_LETTER_AT, OutboxDispatcher } from '../src/outbox/dispatcher';
import {
  CRM_SECRET,
  crmDeps,
  daysAgo,
  insertMessage,
  makeCampaign,
  makeCrmShop,
  makePurchase,
  makeVendorCoupon,
  messageRow,
  optIn,
  setAutomation,
  setConsent,
  type Shop,
} from './support/crm';
import {
  FakeMailer,
  eventRow,
  insertEvent,
  makeUser,
  prisma,
  resetDb,
  silentLog,
} from './support/fixtures';
import { makeSettings } from './support/market';

const DAY_MS = 86_400_000;
const ctx = { log: silentLog, batchSize: 50 };

let mailer: FakeMailer;
let dispatcher: OutboxDispatcher;

beforeEach(async () => {
  await resetDb();
  await makeSettings();
  mailer = new FakeMailer();
  dispatcher = new OutboxDispatcher(
    createHandlers({
      mailer,
      providers: {},
      webOrigin: 'http://web.test',
      adminOrigin: 'http://admin.test',
      apiPublicUrl: 'http://api.test',
    }),
    silentLog,
    { batchSize: 10, concurrency: 1, pollIntervalMs: 10 },
  );
});
afterAll(() => prisma.$disconnect());

const dispatchDue = () => dispatchDueCrmMessages(ctx, crmDeps(mailer));
const messagesOf = (subOrderId: string) =>
  prisma.crmMessage.findMany({ where: { subOrderId }, orderBy: { automationKind: 'asc' } });
const tokenFor = (userId: string, vendorId: string) =>
  deriveUnsubscribeToken(CRM_SECRET, userId, vendorId);

describe('renderCrmEmail', () => {
  it('escapes shop text, adds the coupon line, actions and both unsubscribe links', () => {
    const mail = renderCrmEmail({
      locale: 'en',
      subject: 'New message from <b>Lotus</b>',
      body: 'Hi Lan,\n<script>alert(1)</script>',
      shopName: 'Lotus & Co',
      couponCode: 'COMEBACK10',
      actions: [{ label: 'Visit shop', url: 'http://web.test/en/vendors/lotus?a=1&b=2' }],
      unsubscribe: { marketing: 'http://web.test/m', all: 'http://web.test/a' },
    });
    expect(mail.subject).toBe('New message from <b>Lotus</b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('href="http://web.test/en/vendors/lotus?a=1&amp;b=2"');
    expect(mail.text).toContain('Use voucher: COMEBACK10');
    expect(mail.text).toContain(
      'You receive this email because you bought from Lotus & Co on Elma.',
    );
    expect(mail.text).toContain('Unsubscribe from marketing emails: http://web.test/m');
    expect(mail.text).toContain('Unsubscribe from all emails from this shop: http://web.test/a');
  });
});

describe('scheduling (outbox handlers)', () => {
  it('sub-order.delivered sends the delivery email AND schedules THANK_YOU + REVIEW_REQUEST', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU', { delayDays: 2 });
    await setAutomation(shop.vendor.id, 'REVIEW_REQUEST', { delayDays: 3 });
    await setAutomation(shop.vendor.id, 'REORDER_REMINDER');
    const deliveredAt = daysAgo(1);
    const { customer, order, subOrder } = await makePurchase(shop, { deliveredAt });
    const payload = { orderId: order.id, subOrderId: subOrder.id, customerId: customer.id };
    await insertEvent('sub-order.delivered', payload);

    await dispatcher.pollOnce();

    expect(mailer.sent).toHaveLength(1); // the existing delivery email still goes out
    const messages = await messagesOf(subOrder.id);
    expect(messages.map((m) => [m.automationKind, m.kind, m.status])).toEqual([
      ['THANK_YOU', 'SERVICE', 'SCHEDULED'],
      ['REVIEW_REQUEST', 'SERVICE', 'SCHEDULED'],
    ]);
    expect(messages[0]?.scheduledFor.getTime()).toBe(deliveredAt.getTime() + 2 * DAY_MS);
    expect(messages[1]?.scheduledFor.getTime()).toBe(deliveredAt.getTime() + 3 * DAY_MS);
    expect(messages.every((m) => m.userId === customer.id && m.vendorId === shop.vendor.id)).toBe(
      true,
    );

    // Redelivery (or a second event) never duplicates.
    await insertEvent('sub-order.delivered', payload);
    await dispatcher.pollOnce();
    expect(await messagesOf(subOrder.id)).toHaveLength(2);
  });

  it('schedules nothing for disabled automations or a sub-order refunded meanwhile', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU', { isEnabled: false });
    const a = await makePurchase(shop);
    await setAutomation(shop.vendor.id, 'REVIEW_REQUEST');
    const b = await makePurchase(shop, { status: 'REFUNDED' });
    for (const p of [a, b]) {
      await insertEvent('sub-order.delivered', {
        orderId: p.order.id,
        subOrderId: p.subOrder.id,
        customerId: p.customer.id,
      });
    }
    await dispatcher.pollOnce();
    expect(await prisma.crmMessage.count()).toBe(1); // only REVIEW_REQUEST for `a`
    expect((await messagesOf(a.subOrder.id))[0]?.automationKind).toBe('REVIEW_REQUEST');
  });

  it('sub-order.completed schedules REORDER_REMINDER, and THANK_YOU from completedAt when never delivered', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU', { delayDays: 0 });
    await setAutomation(shop.vendor.id, 'REORDER_REMINDER', { delayDays: 30 });
    const completedAt = daysAgo(2);
    const { order, subOrder } = await makePurchase(shop, {
      status: 'COMPLETED',
      deliveredAt: null,
      completedAt,
    });
    const event = await insertEvent('sub-order.completed', {
      orderId: order.id,
      subOrderId: subOrder.id,
      vendorId: shop.vendor.id,
    });

    await dispatcher.pollOnce();

    expect((await eventRow(event.id)).processedAt).not.toBeNull();
    const messages = await messagesOf(subOrder.id);
    expect(messages.map((m) => [m.automationKind, m.kind])).toEqual([
      ['THANK_YOU', 'SERVICE'],
      ['REORDER_REMINDER', 'MARKETING'],
    ]);
    expect(messages[0]?.scheduledFor.getTime()).toBe(completedAt.getTime());
    expect(messages[1]?.scheduledFor.getTime()).toBe(completedAt.getTime() + 30 * DAY_MS);
  });

  it('dead-letters sub-order.completed whose vendorId does not match', async () => {
    const shop = await makeCrmShop();
    const { order, subOrder } = await makePurchase(shop, { status: 'COMPLETED' });
    const event = await insertEvent('sub-order.completed', {
      orderId: order.id,
      subOrderId: subOrder.id,
      vendorId: ulid(),
    });
    await dispatcher.pollOnce();
    const row = await eventRow(event.id);
    expect(row.processedAt).toBeNull();
    expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
  });

  it('an order delivered earlier gets no retroactive THANK_YOU / REVIEW_REQUEST on completion', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    await setAutomation(shop.vendor.id, 'REVIEW_REQUEST');
    await setAutomation(shop.vendor.id, 'REORDER_REMINDER');
    const { order, subOrder } = await makePurchase(shop, {
      status: 'COMPLETED',
      deliveredAt: daysAgo(8),
      completedAt: daysAgo(1),
    });
    await insertEvent('sub-order.completed', {
      orderId: order.id,
      subOrderId: subOrder.id,
      vendorId: shop.vendor.id,
    });
    await dispatcher.pollOnce();
    expect((await messagesOf(subOrder.id)).map((m) => m.automationKind)).toEqual([
      'REORDER_REMINDER',
    ]);
  });
});

describe('crm-dispatch-messages', () => {
  async function dueThankYou(
    shop: Shop,
    data: { email?: string | null; locale?: 'VI' | 'EN' } = {},
  ) {
    const customer = await makeUser({
      name: 'Lan Nguyen',
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.locale ? { primaryLocale: data.locale } : {}),
    });
    const { subOrder, order } = await makePurchase(shop, { customer });
    const message = await insertMessage({
      vendorId: shop.vendor.id,
      userId: customer.id,
      kind: 'SERVICE',
      automationKind: 'THANK_YOU',
      subOrderId: subOrder.id,
    });
    return { customer, subOrder, order, message };
  }

  it('sends a THANK_YOU: notification + email with RFC 8058 headers and a working unsubscribe token', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { customer, message } = await dueThankYou(shop, { email: 'lan@example.com' });

    const summary = await dispatchDue();

    expect(summary).toMatchObject({ candidates: 1, done: 1, failed: 0 });
    const row = await messageRow(message.id);
    expect(row.status).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    const notification = await prisma.notification.findUniqueOrThrow({
      where: { id: row.notificationId ?? '' },
    });
    expect(notification).toMatchObject({
      userId: customer.id,
      vendorId: shop.vendor.id,
      title: 'Lotus Shop gửi lời cảm ơn',
      body: 'Chào Lan Nguyen, cảm ơn bạn đã mua hàng tại Lotus Shop! Chúc bạn hài lòng với sản phẩm.',
      linkPath: `/vendors/${shop.vendor.slug}`,
    });

    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    const token = await tokenFor(customer.id, shop.vendor.id);
    expect(mail?.to).toBe('lan@example.com');
    expect(mail?.subject).toBe('Lotus Shop gửi lời cảm ơn');
    expect(mail?.headers).toEqual({
      'List-Unsubscribe': `<http://api.test/v1/crm/unsubscribe/one-click?token=${token}&scope=ALL>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(mail?.text).toContain(`http://web.test/vi/unsubscribe?token=${token}&scope=ALL`);
    expect(mail?.text).not.toContain('scope=MARKETING'); // service mail: no marketing link
    expect(mail?.text).toContain(`http://web.test/vi/vendors/${shop.vendor.slug}`);
    // The preference row now exists with the hash the API looks the token up by.
    const pref = await prisma.customerVendorPreference.findUniqueOrThrow({
      where: { userId_vendorId: { userId: customer.id, vendorId: shop.vendor.id } },
    });
    expect(pref.unsubscribeTokenHash).toBe(await hashUnsubscribeToken(token));
  });

  it('renders the shop template in the customer locale (en falls back to vi) and REVIEW_REQUEST links the order', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'REVIEW_REQUEST', {
      templateVi: 'Chào {customerName}, {shopName} mong nhận đánh giá.',
      templateEn: 'Hi {customerName}, please review {shopName}.',
    });
    await setAutomation(shop.vendor.id, 'THANK_YOU', { templateVi: 'Cảm ơn {customerName}!' });
    const en = await makeUser({ name: 'Ann', primaryLocale: 'EN', email: 'ann@example.com' });
    const p = await makePurchase(shop, { customer: en });
    await insertMessage({
      vendorId: shop.vendor.id,
      userId: en.id,
      kind: 'SERVICE',
      automationKind: 'REVIEW_REQUEST',
      subOrderId: p.subOrder.id,
    });
    await insertMessage({
      vendorId: shop.vendor.id,
      userId: en.id,
      kind: 'SERVICE',
      automationKind: 'THANK_YOU',
      subOrderId: p.subOrder.id,
    });

    await dispatchDue();

    const notes = await prisma.notification.findMany({ orderBy: { title: 'asc' } });
    expect(notes.map((n) => [n.title, n.body, n.linkPath])).toEqual([
      ['Lotus Shop sent you a thank-you', 'Cảm ơn Ann!', `/vendors/${shop.vendor.slug}`],
      [
        'Lotus Shop would love your review',
        'Hi Ann, please review Lotus Shop.',
        `/account/orders/${p.order.id}`,
      ],
    ]);
    const review = mailer.sent.find((m) => m.subject.includes('review'));
    expect(review?.text).toContain(
      `Write a review: http://web.test/en/account/orders/${p.order.id}`,
    );
  });

  it('a customer without email gets the in-app notification only', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { message } = await dueThankYou(shop, { email: null });
    await dispatchDue();
    expect((await messageRow(message.id)).status).toBe('SENT');
    expect(await prisma.notification.count()).toBe(1);
    expect(mailer.sent).toHaveLength(0);
  });

  it('leaves messages that are not due yet untouched', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { customer, subOrder } = await makePurchase(shop);
    const message = await insertMessage({
      vendorId: shop.vendor.id,
      userId: customer.id,
      kind: 'SERVICE',
      automationKind: 'THANK_YOU',
      subOrderId: subOrder.id,
      scheduledFor: new Date(Date.now() + DAY_MS),
    });
    expect(await dispatchDue()).toMatchObject({ candidates: 0 });
    expect((await messageRow(message.id)).status).toBe('SCHEDULED');
  });

  describe('skip reasons (re-checked at send time)', () => {
    const cases: [CrmSkipReason, (shop: Shop) => Promise<string>][] = [
      [
        'VENDOR_INACTIVE',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'THANK_YOU');
          const { message } = await dueThankYou(shop);
          await prisma.vendor.update({
            where: { id: shop.vendor.id },
            data: { status: 'SUSPENDED' },
          });
          return message.id;
        },
      ],
      [
        'AUTOMATION_DISABLED',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'THANK_YOU', { isEnabled: false });
          return (await dueThankYou(shop)).message.id;
        },
      ],
      [
        'ORDER_REFUNDED',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'THANK_YOU');
          const { message, subOrder } = await dueThankYou(shop);
          await prisma.subOrder.update({
            where: { id: subOrder.id },
            data: { status: 'REFUNDED' },
          });
          return message.id;
        },
      ],
      [
        'OPTED_OUT',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'THANK_YOU');
          const { message, customer } = await dueThankYou(shop);
          await setConsent(customer.id, shop.vendor.id, { serviceOptOutAt: daysAgo(1) });
          return message.id;
        },
      ],
      [
        'NO_CONSENT',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'REORDER_REMINDER');
          const { customer, subOrder } = await makePurchase(shop, {
            status: 'COMPLETED',
            completedAt: daysAgo(40),
          });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              automationKind: 'REORDER_REMINDER',
              subOrderId: subOrder.id,
            })
          ).id;
        },
      ],
      [
        'ALREADY_REVIEWED',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'REVIEW_REQUEST');
          const { customer, subOrder } = await makePurchase(shop);
          await prisma.review.create({
            data: {
              id: ulid(),
              productId: shop.product.id,
              authorId: customer.id,
              subOrderId: subOrder.id,
              rating: 5,
            },
          });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'SERVICE',
              automationKind: 'REVIEW_REQUEST',
              subOrderId: subOrder.id,
            })
          ).id;
        },
      ],
      [
        'ALREADY_REORDERED',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'REORDER_REMINDER');
          const { customer, subOrder } = await makePurchase(shop, {
            status: 'COMPLETED',
            createdAt: daysAgo(50),
            completedAt: daysAgo(40),
          });
          await optIn(customer.id, shop.vendor.id);
          await makePurchase(shop, { customer, status: 'PAID', createdAt: daysAgo(5) });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              automationKind: 'REORDER_REMINDER',
              subOrderId: subOrder.id,
            })
          ).id;
        },
      ],
      [
        'FREQUENCY_CAP',
        async (shop) => {
          const customer = await makeUser();
          await makePurchase(shop, { customer, status: 'COMPLETED' });
          await optIn(customer.id, shop.vendor.id);
          for (const days of [1, 6]) {
            const old = await makeCampaign(shop.vendor.id, { status: 'SENT' });
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              campaignId: old.id,
              status: 'SENT',
              sentAt: daysAgo(days),
            });
          }
          const campaign = await makeCampaign(shop.vendor.id, { status: 'SENDING' });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              campaignId: campaign.id,
            })
          ).id;
        },
      ],
      [
        'CAMPAIGN_CANCELLED',
        async (shop) => {
          const customer = await makeUser();
          await optIn(customer.id, shop.vendor.id);
          const campaign = await makeCampaign(shop.vendor.id, { status: 'CANCELLED' });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              campaignId: campaign.id,
            })
          ).id;
        },
      ],
      [
        'COUPON_INVALID',
        async (shop) => {
          const coupon = await makeVendorCoupon(shop.vendor.id, { endsAt: daysAgo(1) });
          await setAutomation(shop.vendor.id, 'REORDER_REMINDER', {
            templateVi: 'Dùng mã {couponCode} nhé {customerName}!',
            couponId: coupon.id,
          });
          const { customer, subOrder } = await makePurchase(shop, {
            status: 'COMPLETED',
            completedAt: daysAgo(40),
          });
          await optIn(customer.id, shop.vendor.id);
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'MARKETING',
              automationKind: 'REORDER_REMINDER',
              subOrderId: subOrder.id,
            })
          ).id;
        },
      ],
      [
        'NO_CHANNEL',
        async (shop) => {
          await setAutomation(shop.vendor.id, 'THANK_YOU');
          const customer = await makeUser({ email: null });
          const { subOrder } = await makePurchase(shop, { customer });
          return (
            await insertMessage({
              vendorId: shop.vendor.id,
              userId: customer.id,
              kind: 'SERVICE',
              automationKind: 'THANK_YOU',
              subOrderId: subOrder.id,
              channels: ['EMAIL'],
            })
          ).id;
        },
      ],
    ];

    it.each(cases)('%s', async (reason, arrange) => {
      const shop = await makeCrmShop();
      const id = await arrange(shop);
      const summary = await dispatchDue();
      expect(summary).toMatchObject({ done: 1, failed: 0 });
      const row = await messageRow(id);
      expect(row).toMatchObject({ status: 'SKIPPED', skipReason: reason, notificationId: null });
      expect(await prisma.notification.count()).toBe(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it('OPTED_OUT for marketing after an opt-out that followed the opt-in', async () => {
      const shop = await makeCrmShop();
      const customer = await makeUser();
      await setConsent(customer.id, shop.vendor.id, {
        marketingOptInAt: daysAgo(10),
        marketingOptOutAt: daysAgo(2),
      });
      const campaign = await makeCampaign(shop.vendor.id, { status: 'SENDING' });
      const message = await insertMessage({
        vendorId: shop.vendor.id,
        userId: customer.id,
        kind: 'MARKETING',
        campaignId: campaign.id,
      });
      await dispatchDue();
      expect(await messageRow(message.id)).toMatchObject({
        status: 'SKIPPED',
        skipReason: 'OPTED_OUT',
      });
    });
  });

  it('REORDER_REMINDER with a valid coupon: code line added (default template) or inline ({couponCode})', async () => {
    const shop = await makeCrmShop();
    const coupon = await makeVendorCoupon(shop.vendor.id, { code: 'COMEBACK10' });
    await setAutomation(shop.vendor.id, 'REORDER_REMINDER', { couponId: coupon.id });
    const a = await makePurchase(shop, { status: 'COMPLETED', completedAt: daysAgo(40) });
    await optIn(a.customer.id, shop.vendor.id);
    await insertMessage({
      vendorId: shop.vendor.id,
      userId: a.customer.id,
      kind: 'MARKETING',
      automationKind: 'REORDER_REMINDER',
      subOrderId: a.subOrder.id,
    });
    await dispatchDue();
    expect(mailer.sent[0]?.text).toContain('Dùng mã giảm giá: COMEBACK10');
    expect(mailer.sent[0]?.text).toContain('scope=MARKETING'); // marketing mail: both links
    expect(mailer.sent[0]?.headers?.['List-Unsubscribe']).toContain('scope=MARKETING');

    await setAutomation(shop.vendor.id, 'REORDER_REMINDER', {
      couponId: coupon.id,
      templateVi: 'Mã {couponCode} cho {customerName}',
    });
    const b = await makePurchase(shop, { status: 'COMPLETED', completedAt: daysAgo(40) });
    await optIn(b.customer.id, shop.vendor.id);
    await insertMessage({
      vendorId: shop.vendor.id,
      userId: b.customer.id,
      kind: 'MARKETING',
      automationKind: 'REORDER_REMINDER',
      subOrderId: b.subOrder.id,
    });
    await dispatchDue();
    expect(mailer.sent[1]?.text).toContain('Mã COMEBACK10 cho Lan Nguyen');
    expect(mailer.sent[1]?.text).not.toContain('Dùng mã giảm giá:');
  });

  it('a failing send rolls back, records the attempt, retries later and ends FAILED', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { message } = await dueThankYou(shop, { email: 'lan@example.com' });
    mailer.failWith = new Error('550 mailbox unavailable: lan@example.com');

    expect(await dispatchDue()).toMatchObject({ failed: 1 });
    let row = await messageRow(message.id);
    expect(row).toMatchObject({
      status: 'SCHEDULED',
      attempts: 1,
      notificationId: null,
      sentAt: null,
    });
    expect(row.lastError).toBe('Error: 550 mailbox unavailable: [email]');
    expect(row.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.notification.count()).toBe(0); // reverted with the SENT mark

    // Due again on its 5th failure → FAILED.
    await prisma.crmMessage.update({
      where: { id: message.id },
      data: { attempts: 4, scheduledFor: new Date(Date.now() - 1000) },
    });
    await dispatchDue();
    row = await messageRow(message.id);
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, notificationId: null });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('skips a message far past its scheduledFor as STALE (outage / backlog)', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { customer, subOrder } = await makePurchase(shop);
    const message = await insertMessage({
      vendorId: shop.vendor.id,
      userId: customer.id,
      kind: 'SERVICE',
      automationKind: 'THANK_YOU',
      subOrderId: subOrder.id,
      scheduledFor: daysAgo(4),
    });
    await dispatchDue();
    expect(await messageRow(message.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'STALE' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('with CRM email disabled only the in-app notification is sent', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { message } = await dueThankYou(shop, { email: 'lan@example.com' });
    await dispatchDueCrmMessages(ctx, { ...crmDeps(mailer), emailEnabled: false });
    expect((await messageRow(message.id)).status).toBe('SENT');
    expect(await prisma.notification.count()).toBe(1);
    expect(mailer.sent).toHaveLength(0);
  });

  it('a customer name that looks like a link is replaced; a link-like shop name fails at once', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const spoof = await makeUser({ name: 'claim at evil.com/win' });
    const p = await makePurchase(shop, { customer: spoof });
    await insertMessage({
      vendorId: shop.vendor.id,
      userId: spoof.id,
      kind: 'SERVICE',
      automationKind: 'THANK_YOU',
      subOrderId: p.subOrder.id,
    });
    await dispatchDue();
    const note = await prisma.notification.findFirstOrThrow();
    expect(note.body).toContain('Chào bạn,');
    expect(note.body).not.toContain('evil.com');

    const linkShop = await makeCrmShop({ name: 'lotus.vn' });
    await setAutomation(linkShop.vendor.id, 'THANK_YOU');
    const { message } = await dueThankYou(linkShop);
    expect(await dispatchDue()).toMatchObject({ failed: 1 });
    expect(await messageRow(message.id)).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('refreshes a preference hash written under an older secret', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    const { customer } = await dueThankYou(shop);
    await prisma.customerVendorPreference.create({
      data: { userId: customer.id, vendorId: shop.vendor.id, unsubscribeTokenHash: 'old-hash' },
    });
    await dispatchDue();
    const pref = await prisma.customerVendorPreference.findUniqueOrThrow({
      where: { userId_vendorId: { userId: customer.id, vendorId: shop.vendor.id } },
    });
    expect(pref.unsubscribeTokenHash).toBe(
      await hashUnsubscribeToken(await tokenFor(customer.id, shop.vendor.id)),
    );
  });

  it('handles at most CRM_DISPATCH_MAX_PER_RUN messages per run', async () => {
    const shop = await makeCrmShop();
    const campaign = await makeCampaign(shop.vendor.id, { status: 'SENDING' });
    const users = Array.from({ length: CRM_DISPATCH_MAX_PER_RUN + 1 }, (_, i) => ({
      id: ulid(),
      name: `Customer ${i}`,
      primaryLocale: 'VI' as const,
    }));
    await prisma.user.createMany({ data: users });
    await prisma.crmMessage.createMany({
      data: users.map((u) => ({
        id: ulid(),
        vendorId: shop.vendor.id,
        userId: u.id,
        kind: 'MARKETING' as const,
        campaignId: campaign.id,
        channels: ['IN_APP' as const],
        scheduledFor: new Date(Date.now() - 60_000),
      })),
    });
    const summary = await dispatchDue();
    expect(summary.candidates).toBe(CRM_DISPATCH_MAX_PER_RUN);
    expect(await prisma.crmMessage.count({ where: { status: 'SCHEDULED' } })).toBe(1);
  });

  it('two workers in parallel send every message exactly once', async () => {
    const shop = await makeCrmShop();
    await setAutomation(shop.vendor.id, 'THANK_YOU');
    for (let i = 0; i < 6; i += 1) await dueThankYou(shop);

    const results = await Promise.all([
      dispatchDueCrmMessages({ log: silentLog, batchSize: 2 }, crmDeps(mailer)),
      dispatchDueCrmMessages({ log: silentLog, batchSize: 2 }, crmDeps(mailer)),
    ]);

    expect(results.reduce((n, r) => n + r.done, 0)).toBe(6);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    expect(mailer.sent).toHaveLength(6);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(6);
    expect(await prisma.notification.count()).toBe(6);
    expect(await prisma.crmMessage.count({ where: { status: 'SENT' } })).toBe(6);
  });

  it('the weekly marketing cap holds when two workers race on the same customer', async () => {
    const shop = await makeCrmShop();
    const customer = await makeUser();
    await makePurchase(shop, { customer, status: 'COMPLETED' });
    await optIn(customer.id, shop.vendor.id);
    for (let i = 0; i < 3; i += 1) {
      const campaign = await makeCampaign(shop.vendor.id, { status: 'SENDING' });
      await insertMessage({
        vendorId: shop.vendor.id,
        userId: customer.id,
        kind: 'MARKETING',
        campaignId: campaign.id,
      });
    }
    await Promise.all([
      dispatchDueCrmMessages({ log: silentLog, batchSize: 1 }, crmDeps(mailer)),
      dispatchDueCrmMessages({ log: silentLog, batchSize: 1 }, crmDeps(mailer)),
    ]);
    const rows = await prisma.crmMessage.findMany({ where: { userId: customer.id } });
    expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(2);
    expect(rows.filter((r) => r.skipReason === 'FREQUENCY_CAP')).toHaveLength(1);
  });
});

describe('campaigns', () => {
  async function shopWithCustomers() {
    const shop = await makeCrmShop();
    const optedIn = [];
    for (const name of ['An', 'Binh']) {
      const customer = await makeUser({ name });
      await makePurchase(shop, { customer, status: 'COMPLETED' });
      await optIn(customer.id, shop.vendor.id);
      optedIn.push(customer);
    }
    const silent = await makeUser({ name: 'Chi' });
    await makePurchase(shop, { customer: silent, status: 'COMPLETED' }); // no consent
    // A customer of ANOTHER shop who opted in there only.
    const other = await makeCrmShop({ name: 'Other' });
    const stranger = await makeUser({ name: 'Dung' });
    await makePurchase(other, { customer: stranger, status: 'COMPLETED' });
    await optIn(stranger.id, other.vendor.id);
    return { shop, optedIn };
  }

  it('crm.campaign.scheduled starts a due campaign; messages are sent; the campaign ends SENT', async () => {
    const { shop, optedIn } = await shopWithCustomers();
    const campaign = await makeCampaign(shop.vendor.id);
    const event = await insertEvent('crm.campaign.scheduled', {
      campaignId: campaign.id,
      vendorId: shop.vendor.id,
    });

    await dispatcher.pollOnce();

    expect((await eventRow(event.id)).processedAt).not.toBeNull();
    let row = await prisma.crmCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row).toMatchObject({ status: 'SENDING', recipientCount: 2 });
    expect(row.startedAt).not.toBeNull();
    const messages = await prisma.crmMessage.findMany({ where: { campaignId: campaign.id } });
    expect(messages.map((m) => m.userId).sort()).toEqual(optedIn.map((c) => c.id).sort());
    expect(messages.every((m) => m.kind === 'MARKETING' && m.status === 'SCHEDULED')).toBe(true);

    expect(await dispatchDue()).toMatchObject({ done: 2, failed: 0 });
    expect(mailer.sent.map((m) => m.subject)).toEqual([
      'Tin mới từ Lotus Shop',
      'Tin mới từ Lotus Shop',
    ]);
    expect(mailer.sent.map((m) => m.text.split('\n\n')[0]).sort()).toEqual([
      'Chào An, Lotus Shop có ưu đãi mới!',
      'Chào Binh, Lotus Shop có ưu đãi mới!',
    ]);
    row = await prisma.crmCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(row.status).toBe('SENT');
    expect(row.completedAt).not.toBeNull();
  });

  it('a campaign not due yet is left SCHEDULED by the handler and the job', async () => {
    const { shop } = await shopWithCustomers();
    const campaign = await makeCampaign(shop.vendor.id, {
      scheduledAt: new Date(Date.now() + DAY_MS),
    });
    const event = await insertEvent('crm.campaign.scheduled', {
      campaignId: campaign.id,
      vendorId: shop.vendor.id,
    });
    await dispatcher.pollOnce();
    expect(await startDueCampaigns(ctx)).toMatchObject({ candidates: 0 });
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
    expect(
      (await prisma.crmCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).status,
    ).toBe('SCHEDULED');
    expect(await prisma.crmMessage.count()).toBe(0);
  });

  it('cancels at send time when the vendor is suspended or the coupon expired', async () => {
    const { shop } = await shopWithCustomers();
    const expired = await makeVendorCoupon(shop.vendor.id, { endsAt: daysAgo(1) });
    const withCoupon = await makeCampaign(shop.vendor.id, {
      couponId: expired.id,
      templateVi: 'Mã {couponCode}',
    });
    const suspendedShop = await makeCrmShop({ status: 'SUSPENDED' });
    const ofSuspended = await makeCampaign(suspendedShop.vendor.id);

    expect(await startDueCampaigns(ctx)).toMatchObject({ candidates: 2, done: 2 });

    const rows = await prisma.crmCampaign.findMany({
      where: { id: { in: [withCoupon.id, ofSuspended.id] } },
    });
    expect(Object.fromEntries(rows.map((r) => [r.id, [r.status, r.cancelReason]]))).toEqual({
      [withCoupon.id]: ['CANCELLED', 'coupon-invalid'],
      [ofSuspended.id]: ['CANCELLED', 'vendor-inactive'],
    });
    expect(await prisma.crmMessage.count()).toBe(0);
  });

  it('handler and job racing on one campaign create one set of messages', async () => {
    const { shop } = await shopWithCustomers();
    const campaign = await makeCampaign(shop.vendor.id);
    await insertEvent('crm.campaign.scheduled', {
      campaignId: campaign.id,
      vendorId: shop.vendor.id,
    });
    await Promise.all([dispatcher.pollOnce(), startDueCampaigns(ctx), startDueCampaigns(ctx)]);
    expect(await prisma.crmMessage.count({ where: { campaignId: campaign.id } })).toBe(2);
    expect(
      (await prisma.crmCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).recipientCount,
    ).toBe(2);
  });

  it('an audience that emptied before send time ends SENT with 0 recipients', async () => {
    const shop = await makeCrmShop();
    const campaign = await makeCampaign(shop.vendor.id);
    await startDueCampaigns(ctx);
    expect(
      await prisma.crmCampaign.findUniqueOrThrow({ where: { id: campaign.id } }),
    ).toMatchObject({
      status: 'SENT',
      recipientCount: 0,
    });
  });
});
