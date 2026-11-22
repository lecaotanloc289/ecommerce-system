import { describe, it, expect, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { prisma } from '../src/client.js';
import { RefundStatus } from '../src/index.js';

// Exercises the `add_marketplace_ops_fields` migration inside transactions that always roll back,
// so the shared local DB is left untouched. Rows are self-contained (no dependency on the seed).
const rollback = new Error('rollback');

async function withRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(
    prisma.$transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

async function createPaidSubOrder(tx: Prisma.TransactionClient) {
  const user = await tx.user.create({
    data: { id: ulid(), email: `${ulid()}@test.local`, name: 'T' },
  });
  const vendor = await tx.vendor.create({
    data: { id: ulid(), ownerId: user.id, slug: `v-${ulid()}`, displayName: 'V', status: 'ACTIVE' },
  });
  const order = await tx.order.create({
    data: {
      id: ulid(),
      customerId: user.id,
      currency: 'VND',
      itemsTotalAmount: 100_000n,
      shippingTotalAmount: 0n,
      grandTotalAmount: 100_000n,
      idempotencyKey: ulid(),
      paymentDeadlineAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const subOrder = await tx.subOrder.create({
    data: {
      id: ulid(),
      orderId: order.id,
      vendorId: vendor.id,
      subtotalAmount: 100_000n,
      shippingAmount: 0n,
      currency: 'VND',
      shippingAddress: {},
    },
  });
  const payment = await tx.payment.create({
    data: {
      id: ulid(),
      orderId: order.id,
      provider: 'VNPAY',
      amount: 100_000n,
      currency: 'VND',
      redirectUrl: 'https://pay.example.test/session',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  return { user, vendor, order, subOrder, payment };
}

describe('marketplace ops schema', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('defaults the new money/time columns', async () => {
    await withRollback(async (tx) => {
      const { subOrder, payment, order } = await createPaidSubOrder(tx);
      expect(subOrder.platformDiscountAmount).toBe(0n);
      expect(subOrder.shippedAt).toBeNull();
      expect(payment.redirectUrl).toBe('https://pay.example.test/session');
      expect(order.paymentDeadlineAt).toBeInstanceOf(Date);

      const event = await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateId: order.id,
          aggregateType: 'Order',
          eventType: 'order.created',
        },
      });
      expect(event.nextAttemptAt).toBeInstanceOf(Date);

      const settings = await tx.platformSettings.create({
        data: { id: ulid(), supportedCurrencies: ['VND'] },
      });
      expect(settings.paymentTimeoutMinutes).toBe(30);
    });
  });

  it('accepts BLOCKED products with a reason and suspended vendors with a reason', async () => {
    await withRollback(async (tx) => {
      const { vendor } = await createPaidSubOrder(tx);
      const product = await tx.product.create({
        data: {
          id: ulid(),
          vendorId: vendor.id,
          status: 'BLOCKED',
          blockedReason: 'counterfeit',
          basePriceAmount: 1n,
        },
      });
      expect(product.status).toBe('BLOCKED');
      const suspended = await tx.vendor.update({
        where: { id: vendor.id },
        data: { status: 'SUSPENDED', suspendedReason: 'kyc expired' },
      });
      expect(suspended.suspendedReason).toBe('kyc expired');
    });
  });

  it('allows a retry after a FAILED refund but at most one non-FAILED refund per sub-order', async () => {
    await withRollback(async (tx) => {
      const { user, subOrder, payment } = await createPaidSubOrder(tx);
      const base = {
        subOrderId: subOrder.id,
        paymentId: payment.id,
        amount: 100_000n,
        currency: 'VND' as const,
        reason: 'customer request',
        requestedById: user.id,
      };
      await tx.refund.create({ data: { id: ulid(), ...base, status: RefundStatus.FAILED } });
      const retry = await tx.refund.create({ data: { id: ulid(), ...base } });
      expect(retry.status).toBe(RefundStatus.PENDING);
      // Last statement in the transaction: a constraint violation aborts it in Postgres.
      await expect(tx.refund.create({ data: { id: ulid(), ...base } })).rejects.toMatchObject({
        code: 'P2002',
      });
    });
  });

  it('stores vendor invitations with a unique token hash', async () => {
    await withRollback(async (tx) => {
      const { user, vendor } = await createPaidSubOrder(tx);
      const data = {
        vendorId: vendor.id,
        email: 'staff@example.com',
        tokenHash: `hash-${ulid()}`,
        invitedById: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      };
      const invitation = await tx.vendorInvitation.create({ data: { id: ulid(), ...data } });
      expect(invitation.acceptedAt).toBeNull();
      await expect(
        tx.vendorInvitation.create({ data: { id: ulid(), ...data } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
