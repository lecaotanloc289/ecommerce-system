import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { monotonicFactory } from 'ulid';
import { prisma, type ZaloMessageEvent } from '@repo/db';
import { CredentialsCipher, type ZaloCredentials } from '../src/credentials.js';
import type { Env } from '../src/env.js';

export const ulid = monotonicFactory();
export const logger = pino({ level: 'silent' });
export const KEY = randomBytes(32).toString('base64');
export const cipher = new CredentialsCipher(KEY);

export const testEnv: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? '',
  ZALO_CREDENTIALS_KEY: KEY,
  ZALO_POLL_INTERVAL_MS: 50,
  // Long enough that leases (2 × (sync + call timeout)) never lapse mid-test on a loaded machine;
  // tests call sync() by hand.
  ZALO_ACCOUNT_SYNC_INTERVAL_MS: 30_000,
  ZALO_KEEPALIVE_INTERVAL_MS: 300_000,
  ZALO_SEND_MIN_INTERVAL_MS: 3_000,
  ZALO_MESSAGE_MAX_AGE_HOURS: 24,
  ZALO_MESSAGE_RETENTION_DAYS: 90,
  ZALO_MAX_SEND_ATTEMPTS: 3,
  ZALO_MAX_SESSION_FAILURES: 3,
  ZALO_CALL_TIMEOUT_MS: 500,
  ZALO_MAX_CONCURRENT_LOGINS: 5,
  ZALO_QR_LOGIN_TIMEOUT_MS: 10_000,
};

export function newRedis(): Redis {
  return new Redis(testEnv.REDIS_URL, { maxRetriesPerRequest: null });
}

export async function resetAll(redis: Redis): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, vendors, products, orders, zalo_accounts, zalo_message_templates, zalo_messages CASCADE',
  );
  await redis.flushdb();
}

export async function makeShop(name = 'Shop A') {
  const owner = await prisma.user.create({ data: { id: ulid(), name: `${name} owner` } });
  const vendor = await prisma.vendor.create({
    data: {
      id: ulid(),
      ownerId: owner.id,
      slug: `shop-${ulid().toLowerCase()}`,
      displayName: name,
      status: 'ACTIVE',
    },
  });
  const product = await prisma.product.create({
    data: { id: ulid(), vendorId: vendor.id, status: 'ACTIVE', basePriceAmount: 100_000n },
  });
  const variant = await prisma.productVariant.create({
    data: {
      id: ulid(),
      productId: product.id,
      sku: `SKU-${ulid()}`,
      priceAmount: 100_000n,
      stockOnHand: 10,
    },
  });
  return { owner, vendor, variant };
}

export async function makeSubOrder(input: {
  vendorId: string;
  variantId: string;
  phone?: string;
  status?: 'PAID' | 'SHIPPED' | 'DELIVERED' | 'COMPLETED' | 'REFUNDED' | 'AWAITING_PAYMENT';
  carrier?: string;
  trackingNumber?: string;
}) {
  const customer = await prisma.user.create({ data: { id: ulid(), name: 'Customer' } });
  const order = await prisma.order.create({
    data: {
      id: ulid(),
      customerId: customer.id,
      currency: 'VND',
      itemsTotalAmount: 200_000n,
      shippingTotalAmount: 30_000n,
      discountTotalAmount: 20_000n,
      grandTotalAmount: 210_000n,
      idempotencyKey: ulid(),
      zaloOptIn: true,
    },
  });
  const subOrder = await prisma.subOrder.create({
    data: {
      id: ulid(),
      orderId: order.id,
      vendorId: input.vendorId,
      status: input.status ?? 'PAID',
      subtotalAmount: 200_000n,
      shippingAmount: 30_000n,
      discountAmount: 15_000n,
      platformDiscountAmount: 5_000n,
      currency: 'VND',
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      shippingAddress: {
        recipientName: 'Nguyễn An',
        phone: input.phone ?? '0901 234 567',
        line1: '1 Lê Lợi',
        line2: null,
        ward: 'Bến Nghé',
        district: 'Quận 1',
        city: 'TP.HCM',
        country: 'VN',
      },
      items: {
        create: {
          id: ulid(),
          variantId: input.variantId,
          productTitleSnapshot: 'Áo thun',
          variantAttributesSnapshot: {},
          unitPriceAmount: 100_000n,
          quantity: 2,
          lineTotalAmount: 200_000n,
          currency: 'VND',
        },
      },
    },
  });
  return { order, subOrder };
}

export async function makeTemplate(
  vendorId: string,
  event: ZaloMessageEvent,
  body: string,
  isEnabled = true,
) {
  return prisma.zaloMessageTemplate.create({
    data: { id: ulid(), vendorId, event, body, isEnabled },
  });
}

export async function makeMessage(input: {
  vendorId: string;
  subOrderId: string;
  event: ZaloMessageEvent;
  scheduledAt?: Date;
}) {
  return prisma.zaloMessage.create({
    data: {
      id: ulid(),
      vendorId: input.vendorId,
      subOrderId: input.subOrderId,
      event: input.event,
      scheduledAt: input.scheduledAt ?? new Date(Date.now() - 1_000),
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });
}

export async function makeAccount(input: {
  vendorId: string;
  credentials: ZaloCredentials;
  status?: 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED';
  zaloUid?: string;
}) {
  return prisma.zaloAccount.create({
    data: {
      id: ulid(),
      vendorId: input.vendorId,
      status: input.status ?? 'ACTIVE',
      zaloUid: input.zaloUid ?? `uid-${ulid()}`,
      displayName: 'Shop Zalo',
      credentials: cipher.encrypt(input.credentials, input.vendorId),
      lastLoginAt: new Date(),
    },
  });
}
