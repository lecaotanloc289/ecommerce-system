import { prisma, type Prisma } from '@repo/db';
import { pino } from 'pino';
import { ulid } from 'ulid';
import type { EmailMessage, Mailer } from '../../src/email/mailer';

export { prisma };

/** Silent logger for tests. */
export const silentLog = pino({ level: 'silent' });

/** Empties every table the worker tests write (CASCADE follows users → orders → payments, …). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_events, users CASCADE');
}

/** Collects sent emails instead of talking SMTP. `failWith` makes `send` throw. */
export class FakeMailer implements Mailer {
  readonly sent: EmailMessage[] = [];
  failWith: Error | null = null;

  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function makeUser(
  data: { email?: string | null; name?: string; primaryLocale?: 'VI' | 'EN' } = {},
) {
  const id = ulid();
  return prisma.user.create({
    data: {
      id,
      email: data.email === undefined ? `user-${id.toLowerCase()}@example.com` : data.email,
      name: data.name ?? 'Lan Nguyen',
      primaryLocale: data.primaryLocale ?? 'VI',
    },
  });
}

export function makeOrder(data: {
  customerId: string;
  grandTotal?: bigint;
  currency?: 'VND' | 'USD';
  status?: 'AWAITING_PAYMENT' | 'PAID' | 'CANCELLED';
  paymentDeadlineAt?: Date | null;
}) {
  const grandTotal = data.grandTotal ?? 130_000n;
  return prisma.order.create({
    data: {
      id: ulid(),
      customerId: data.customerId,
      status: data.status ?? 'AWAITING_PAYMENT',
      currency: data.currency ?? 'VND',
      itemsTotalAmount: grandTotal,
      shippingTotalAmount: 0n,
      grandTotalAmount: grandTotal,
      idempotencyKey: ulid(),
      paymentDeadlineAt: data.paymentDeadlineAt === undefined ? null : data.paymentDeadlineAt,
    },
  });
}

export function makePayment(data: {
  orderId: string;
  provider?: 'VNPAY' | 'STRIPE';
  amount?: bigint;
  currency?: 'VND' | 'USD';
  status?: 'PENDING' | 'FAILED' | 'CONFIRMED';
  clientIp?: string | null;
}) {
  return prisma.payment.create({
    data: {
      id: ulid(),
      orderId: data.orderId,
      provider: data.provider ?? 'VNPAY',
      status: data.status ?? 'PENDING',
      amount: data.amount ?? 130_000n,
      currency: data.currency ?? 'VND',
      clientIp: data.clientIp === undefined ? '203.0.113.7' : data.clientIp,
    },
  });
}

/** An ACTIVE vendor (owner = new user) with one sub-order on `orderId`. */
export async function makeSubOrder(data: {
  orderId: string;
  ownerEmail?: string | null;
  ownerLocale?: 'VI' | 'EN';
}) {
  const owner = await makeUser({
    name: 'Shop Owner',
    ...(data.ownerEmail !== undefined ? { email: data.ownerEmail } : {}),
    ...(data.ownerLocale ? { primaryLocale: data.ownerLocale } : {}),
  });
  const vendorId = ulid();
  const vendor = await prisma.vendor.create({
    data: {
      id: vendorId,
      ownerId: owner.id,
      slug: `shop-${vendorId.toLowerCase()}`,
      displayName: 'Lotus Shop',
      status: 'ACTIVE',
    },
  });
  const subOrder = await prisma.subOrder.create({
    data: {
      id: ulid(),
      orderId: data.orderId,
      vendorId: vendor.id,
      status: 'SHIPPED',
      subtotalAmount: 100_000n,
      shippingAmount: 30_000n,
      discountAmount: 5_000n,
      commissionAmount: 9_500n,
      currency: 'VND',
      shippingAddress: { recipientName: 'Lan', city: 'HCM' },
      carrier: 'GHN',
      trackingNumber: 'GHN123456',
    },
  });
  return { owner, vendor, subOrder };
}

export async function makeVendorApplication(data: {
  applicantId: string;
  status: 'APPROVED' | 'REJECTED';
  rejectReason?: string | null;
}) {
  return prisma.vendorApplication.create({
    data: {
      id: ulid(),
      applicantId: data.applicantId,
      status: data.status,
      businessLicenseUrl: 'kyc/license.pdf',
      taxId: '0312345678',
      nationalIdNumber: '079200000001',
      nationalIdUrl: 'kyc/id.png',
      bankName: 'VCB',
      bankAccountNumber: '0011000000001',
      accountHolder: 'NGUYEN LAN',
      rejectReason: data.rejectReason ?? null,
    },
  });
}

/** Inserts an outbox row, due now unless overridden. */
export function insertEvent(
  eventType: string,
  payload: Prisma.InputJsonValue,
  overrides: { attempts?: number; nextAttemptAt?: Date; createdAt?: Date } = {},
) {
  return prisma.outboxEvent.create({
    data: {
      id: ulid(),
      aggregateType: 'order',
      aggregateId: ulid(),
      eventType,
      payload,
      // Prisma fills `@default(now())` from this process's clock while the dispatcher compares
      // with Postgres `now()`; a few ms of host/VM skew would make a fresh row "not due yet".
      nextAttemptAt: new Date(Date.now() - 1000),
      ...overrides,
    },
  });
}

export function eventRow(id: string) {
  return prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
}

/** A vendor (owner = new user) with one open invitation stored with `tokenHash`. */
export async function makeInvitation(data: {
  email: string;
  tokenHash: string;
  revokedAt?: Date | null;
}) {
  const owner = await makeUser({ name: 'Shop Owner' });
  const vendorId = ulid();
  const vendor = await prisma.vendor.create({
    data: {
      id: vendorId,
      ownerId: owner.id,
      slug: `shop-${vendorId.toLowerCase()}`,
      displayName: 'Lotus Shop',
      status: 'ACTIVE',
    },
  });
  const invitation = await prisma.vendorInvitation.create({
    data: {
      id: ulid(),
      vendorId: vendor.id,
      email: data.email,
      tokenHash: data.tokenHash,
      invitedById: owner.id,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      revokedAt: data.revokedAt ?? null,
    },
  });
  return { vendor, invitation };
}
