import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { renderOrderCreated, renderVendorApplicationRejected } from '../src/email/templates';
import { createHandlers } from '../src/handlers';
import { DEAD_LETTER_AT, OutboxDispatcher } from '../src/outbox/dispatcher';
import {
  FakeMailer,
  eventRow,
  insertEvent,
  makeOrder,
  makeSubOrder,
  makeUser,
  makeInvitation,
  makeVendorApplication,
  prisma,
  resetDb,
  silentLog,
} from './support/fixtures';

// Intl uses (narrow) no-break spaces around currency symbols / in dates.
const plain = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

describe('email templates', () => {
  const input = {
    name: 'Lan',
    orderId: '01JDZZ00000000000000000001',
    total: { amount: 130_000, currency: 'VND' as const },
    paymentDeadlineAt: new Date('2026-11-18T18:30:00Z'),
    url: 'https://web.test/vi/order/track?orderId=01JDZZ00000000000000000001',
  };

  it('renders order.created in Vietnamese', () => {
    const mail = renderOrderCreated({ ...input, locale: 'vi' });
    expect(mail.subject).toBe('Chúng tôi đã nhận đơn hàng 01JDZZ00000000000000000001');
    expect(plain(mail.text)).toContain('Xin chào Lan,');
    expect(plain(mail.text)).toContain('Tổng đơn hàng: 130.000 ₫');
    expect(plain(mail.text)).toContain('trước 01:30 19 thg 11, 2026');
    expect(mail.text).toContain(`Xem đơn hàng: ${input.url}`);
    expect(mail.html).toContain(`<a href="${input.url.replace(/&/g, '&amp;')}"`);
    expect(mail.html).toContain('<p style="margin:0 0 16px">Xin chào Lan,</p>');
  });

  it('renders order.created in English', () => {
    const mail = renderOrderCreated({
      ...input,
      locale: 'en',
      total: { amount: 1999, currency: 'USD' },
    });
    expect(mail.subject).toBe('We received your order 01JDZZ00000000000000000001');
    expect(plain(mail.text)).toContain('Hi Lan,');
    expect(plain(mail.text)).toContain('Order total: $19.99');
    expect(plain(mail.text)).toContain('before Nov 19, 2026, 01:30');
  });

  it('escapes user-controlled text in the HTML part', () => {
    const mail = renderVendorApplicationRejected({
      locale: 'en',
      name: '<b>Lan</b>',
      reason: 'Blurry ID <script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Reason: Blurry ID &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('Hi &lt;b&gt;Lan&lt;/b&gt;,');
    expect(mail.text).toContain('Reason: Blurry ID <script>alert(1)</script>');
  });
});

describe('email handlers', () => {
  let mailer: FakeMailer;
  let dispatcher: OutboxDispatcher;

  beforeEach(async () => {
    await resetDb();
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

  it('order.created → customer, in their locale, with the order link', async () => {
    const user = await makeUser({ email: 'lan@example.com', primaryLocale: 'EN' });
    const order = await makeOrder({ customerId: user.id });
    await insertEvent('order.created', { orderId: order.id, customerId: user.id });

    await dispatcher.pollOnce();

    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail?.to).toBe('lan@example.com');
    expect(mail?.subject).toBe(`We received your order ${order.id}`);
    expect(mail?.text).toContain(`http://web.test/en/order/track?orderId=${order.id}`);
  });

  it('order.created is skipped once the order is no longer awaiting payment', async () => {
    const user = await makeUser();
    const order = await makeOrder({ customerId: user.id, status: 'PAID' });
    const event = await insertEvent('order.created', { orderId: order.id, customerId: user.id });

    await dispatcher.pollOnce();

    expect(mailer.sent).toHaveLength(0);
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('order.cancelled → customer with the reason, in Vietnamese', async () => {
    const user = await makeUser({ primaryLocale: 'VI' });
    const order = await makeOrder({ customerId: user.id, status: 'CANCELLED' });
    await insertEvent('order.cancelled', {
      orderId: order.id,
      customerId: user.id,
      reason: 'PAYMENT_EXPIRED',
    });

    await dispatcher.pollOnce();

    expect(mailer.sent[0]?.subject).toBe(`Đơn hàng ${order.id} đã bị huỷ`);
    expect(mailer.sent[0]?.text).toContain('do chưa được thanh toán đúng hạn');
  });

  it('skips a customer without an email address and marks the event processed', async () => {
    const user = await makeUser({ email: null });
    const order = await makeOrder({ customerId: user.id });
    const event = await insertEvent('order.created', { orderId: order.id, customerId: user.id });

    await dispatcher.pollOnce();

    expect(mailer.sent).toHaveLength(0);
    expect((await eventRow(event.id)).processedAt).not.toBeNull();
  });

  it('retries when SMTP fails, without the address in last_error', async () => {
    const user = await makeUser({ email: 'lan@example.com' });
    const order = await makeOrder({ customerId: user.id });
    const event = await insertEvent('order.created', { orderId: order.id, customerId: user.id });
    mailer.failWith = new Error('550 <lan@example.com>: Recipient address rejected');

    await dispatcher.pollOnce();

    const row = await eventRow(event.id);
    expect(row.processedAt).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('Error: 550 <[email]>: Recipient address rejected');
  });

  it('sub-order.shipped / .delivered and payout.released carry the vendor data', async () => {
    const customer = await makeUser({ primaryLocale: 'EN', email: 'lan@example.com' });
    const order = await makeOrder({ customerId: customer.id, status: 'PAID' });
    const { vendor, subOrder } = await makeSubOrder({
      orderId: order.id,
      ownerEmail: 'owner@example.com',
      ownerLocale: 'VI',
    });
    await insertEvent('sub-order.shipped', {
      orderId: order.id,
      subOrderId: subOrder.id,
      customerId: customer.id,
    });
    await insertEvent('sub-order.delivered', {
      orderId: order.id,
      subOrderId: subOrder.id,
      customerId: customer.id,
    });
    // The amount comes from the payout's VENDOR_WALLET ledger entry (here deliberately ≠ the
    // D7 recomputation 115 500, as after an adjustment).
    const txnGroupId = ulid();
    const line = (
      account: 'PLATFORM_ESCROW' | 'VENDOR_WALLET' | 'PLATFORM_REVENUE',
      amount: bigint,
    ) => ({
      id: ulid(),
      txnGroupId,
      account,
      entryType: 'PAYOUT_OUT' as const,
      amount,
      currency: 'VND' as const,
      orderId: order.id,
      subOrderId: subOrder.id,
      vendorId: account === 'VENDOR_WALLET' ? vendor.id : null,
    });
    await prisma.ledgerEntry.createMany({
      data: [
        line('PLATFORM_ESCROW', -125_000n),
        line('VENDOR_WALLET', 115_000n),
        line('PLATFORM_REVENUE', 10_000n),
      ],
    });
    await insertEvent('payout.released', {
      subOrderId: subOrder.id,
      vendorId: vendor.id,
    });

    await dispatcher.pollOnce();

    const toCustomer = mailer.sent.filter((m) => m.to === 'lan@example.com');
    const shipped = toCustomer.find((m) => m.text.includes('has shipped'));
    expect(shipped?.text).toContain('Lotus Shop has shipped your items.');
    expect(shipped?.text).toContain('Carrier: GHN, tracking number: GHN123456');
    const delivered = toCustomer.find((m) => m.subject.includes('delivered'));
    expect(delivered?.subject).toBe(`Part of your order ${order.id} was delivered`);
    expect(delivered?.text).toContain('Lotus Shop marked your items as delivered.');
    expect(delivered?.text).toContain(`http://web.test/en/order/track?orderId=${order.id}`);
    const payout = mailer.sent.find((m) => m.to === 'owner@example.com');
    expect(plain(payout?.text ?? '')).toContain(
      `115.000 ₫ của đơn hàng ${order.id} đã được cộng vào ví của Lotus Shop.`,
    );
    expect(payout?.text).toContain('http://admin.test/');
  });

  it('vendor application approved / rejected → applicant', async () => {
    const approvedUser = await makeUser({ email: 'a@example.com', primaryLocale: 'EN' });
    const rejectedUser = await makeUser({ email: 'r@example.com', primaryLocale: 'VI' });
    const approved = await makeVendorApplication({
      applicantId: approvedUser.id,
      status: 'APPROVED',
    });
    const rejected = await makeVendorApplication({
      applicantId: rejectedUser.id,
      status: 'REJECTED',
      rejectReason: 'Ảnh CCCD bị mờ',
    });
    await insertEvent('vendor.application.approved', {
      applicationId: approved.id,
      vendorId: ulid(), // the handler does not read the vendor
      userId: approvedUser.id,
    });
    await insertEvent('vendor.application.rejected', {
      applicationId: rejected.id,
      userId: rejectedUser.id,
    });

    await dispatcher.pollOnce();

    expect(mailer.sent.find((m) => m.to === 'a@example.com')?.subject).toBe(
      'Your seller application was approved',
    );
    const rejection = mailer.sent.find((m) => m.to === 'r@example.com');
    expect(rejection?.subject).toBe('Đơn đăng ký bán hàng của bạn chưa được duyệt');
    expect(rejection?.text).toContain('Lý do: Ảnh CCCD bị mờ');
  });

  describe('vendor.invitation.created', () => {
    const token = 'tok_' + 'x'.repeat(40);
    const tokenHash = createHash('sha256').update(token).digest('hex');

    it('mails the accept link and scrubs the token from the outbox row', async () => {
      const { vendor, invitation } = await makeInvitation({
        email: 'staff@example.com',
        tokenHash,
      });
      const event = await insertEvent('vendor.invitation.created', {
        invitationId: invitation.id,
        vendorId: vendor.id,
        email: 'staff@example.com',
        token,
      });

      await dispatcher.pollOnce();

      expect(mailer.sent).toHaveLength(1);
      const [mail] = mailer.sent;
      expect(mail?.to).toBe('staff@example.com');
      // No account yet → default locale (vi), nameless greeting.
      expect(mail?.subject).toBe('Bạn được mời tham gia Lotus Shop trên Elma');
      expect(mail?.text).toContain('Xin chào,');
      expect(mail?.text).toContain(`http://admin.test/invite?token=${token}`);
      const row = await eventRow(event.id);
      expect(row.processedAt).not.toBeNull();
      expect(row.payload).toEqual({
        invitationId: invitation.id,
        vendorId: vendor.id,
        email: 'staff@example.com',
      });
    });

    it('uses the invitee account locale and name when one exists', async () => {
      await makeUser({ email: 'staff@example.com', name: 'Minh', primaryLocale: 'EN' });
      const { vendor, invitation } = await makeInvitation({
        email: 'staff@example.com',
        tokenHash,
      });
      await insertEvent('vendor.invitation.created', {
        invitationId: invitation.id,
        vendorId: vendor.id,
        email: 'staff@example.com',
        token,
      });

      await dispatcher.pollOnce();

      expect(mailer.sent[0]?.subject).toBe('You are invited to join Lotus Shop on Elma');
      expect(mailer.sent[0]?.text).toContain('Hi Minh,');
    });

    it('skips a revoked invitation and still scrubs the token', async () => {
      const { vendor, invitation } = await makeInvitation({
        email: 'staff@example.com',
        tokenHash,
        revokedAt: new Date(),
      });
      const event = await insertEvent('vendor.invitation.created', {
        invitationId: invitation.id,
        vendorId: vendor.id,
        email: 'staff@example.com',
        token,
      });

      await dispatcher.pollOnce();

      expect(mailer.sent).toHaveLength(0);
      const row = await eventRow(event.id);
      expect(row.processedAt).not.toBeNull();
      expect(row.payload).not.toHaveProperty('token');
    });

    it('keeps the token while retrying, scrubs it when dead-lettered', async () => {
      const { vendor, invitation } = await makeInvitation({
        email: 'staff@example.com',
        tokenHash,
      });
      const event = await insertEvent(
        'vendor.invitation.created',
        { invitationId: invitation.id, vendorId: vendor.id, email: 'staff@example.com', token },
        { attempts: 8 },
      );
      mailer.failWith = new Error('SMTP down');

      await dispatcher.pollOnce(); // attempt 9: retry, the token is still needed
      expect((await eventRow(event.id)).payload).toHaveProperty('token', token);

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await dispatcher.pollOnce(); // attempt 10: dead-lettered
      const row = await eventRow(event.id);
      expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
      expect(row.payload).not.toHaveProperty('token');
      expect(row.lastError).toBe('Error: SMTP down');
    });

    it('dead-letters a token that does not match the stored hash', async () => {
      const { vendor, invitation } = await makeInvitation({
        email: 'staff@example.com',
        tokenHash,
      });
      const event = await insertEvent('vendor.invitation.created', {
        invitationId: invitation.id,
        vendorId: vendor.id,
        email: 'staff@example.com',
        token: 'wrong_' + 'y'.repeat(40),
      });

      await dispatcher.pollOnce();

      expect(mailer.sent).toHaveLength(0);
      const row = await eventRow(event.id);
      expect(row.nextAttemptAt).toEqual(DEAD_LETTER_AT);
      expect(row.payload).not.toHaveProperty('token');
      expect(row.lastError).not.toContain('wrong_');
    });
  });
});
