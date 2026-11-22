import { Injectable, Logger } from '@nestjs/common';
import {
  deriveOrderStatus,
  DomainError,
  Money,
  ORDER_AGGREGATE_TYPE,
  type Refund,
  type RefundCreate,
  type RefundListItem,
  RefundListItemSchema,
  type RefundListQuery,
  type RefundPage,
  RefundPageSchema,
  type RefundRequestedEvent,
  RefundRequestedEventSchema,
  RefundSchema,
  refundAmount,
  refundPostings,
} from '@repo/core';
import { assertZeroSum, type Prisma, type SubOrderStatus, toDbAmount, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

const REFUND_TX_TIMEOUT_MS = 15_000;

/** D11: an admin may refund a sub-order from PAID up to DELIVERED (not COMPLETED: payout window). */
const REFUNDABLE: readonly SubOrderStatus[] = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
/** Goods are still with the vendor → the stock comes back. From SHIPPED on it may never return. */
const STOCK_RETURNED: readonly SubOrderStatus[] = ['PAID', 'PROCESSING'];

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function notRefundable(subOrderId: string, reason: string): DomainError {
  return new DomainError('refund.error.not-refundable', { subOrderId, reason });
}

type RefundRow = Prisma.RefundGetPayload<object>;

function toRefund(row: RefundRow): Refund {
  return RefundSchema.parse({
    id: row.id,
    subOrderId: row.subOrderId,
    paymentId: row.paymentId,
    amount: toMoney(row.amount, row.currency),
    status: row.status,
    reason: row.reason,
    providerRefundId: row.providerRefundId,
    requestedById: row.requestedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Admin-initiated refunds (roadmap D12): always the WHOLE sub-order (`paid_i`, D7). The API does
 * the bookkeeping in one transaction; the provider refund runs in the worker (`refund.requested`).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async refundSubOrder(adminId: string, subOrderId: string, input: RefundCreate): Promise<Refund> {
    try {
      const refund = await this.prisma.client.$transaction(
        (tx) => this.refundInTx(tx, adminId, subOrderId, input.reason),
        { timeout: REFUND_TX_TIMEOUT_MS },
      );
      this.logger.log({ refundId: refund.id, subOrderId, adminId }, 'sub-order refunded');
      return refund;
    } catch (error) {
      // Backstop: the partial unique index `refunds_sub_order_id_active_key` (one non-FAILED
      // refund per sub-order) — only reachable if a writer skipped the order-row lock.
      if (isUniqueViolation(error)) throw notRefundable(subOrderId, 'refund-exists');
      throw error;
    }
  }

  /**
   * 1. Lock the ORDER row (`FOR UPDATE`) — same first lock as checkout cancel / payment
   *    confirmation — then the sub-order row, so concurrent refunds / fulfilment serialise.
   * 2. Refundable iff status ∈ PAID..DELIVERED, `payoutReleasedAt IS NULL`, the order has a
   *    CONFIRMED payment and the sub-order has no PENDING/SUCCEEDED refund.
   * 3. Refund row (amount = paid_i; PENDING, or SUCCEEDED right away when paid_i = 0).
   * 4. Sub-order → REFUNDED (`WHERE status = <current>`); stock back if not shipped yet.
   * 5. Ledger group `PLATFORM_ESCROW −paid_i`, `CUSTOMER +paid_i` (skipped when 0).
   * 6. `orders.status` re-derived; outbox `refund.requested` (when PENDING).
   */
  private async refundInTx(
    tx: Tx,
    adminId: string,
    subOrderId: string,
    reason: string,
  ): Promise<Refund> {
    const orders = await tx.$queryRaw<{ id: string; customer_id: string }[]>`
      SELECT o.id, o.customer_id
      FROM orders o JOIN sub_orders s ON s.order_id = o.id
      WHERE s.id = ${subOrderId}
      FOR UPDATE OF o`;
    const order = orders[0];
    if (!order) throw new DomainError('sub-order.error.not-found');
    await tx.$queryRaw`SELECT id FROM sub_orders WHERE id = ${subOrderId} FOR UPDATE`;

    // Staff are also customers: nobody refunds their own purchase.
    if (order.customer_id === adminId) throw new DomainError('common.error.forbidden');

    const subOrder = await tx.subOrder.findUniqueOrThrow({
      where: { id: subOrderId },
      include: { items: { select: { variantId: true, quantity: true } } },
    });
    if (!REFUNDABLE.includes(subOrder.status)) throw notRefundable(subOrderId, 'status');
    if (subOrder.payoutReleasedAt !== null) throw notRefundable(subOrderId, 'payout-released');

    const payment = await tx.payment.findFirst({
      where: { orderId: order.id, status: 'CONFIRMED' },
      orderBy: { attemptNo: 'desc' },
    });
    if (!payment) throw notRefundable(subOrderId, 'no-confirmed-payment');

    const active = await tx.refund.findFirst({
      where: { subOrderId, status: { in: ['PENDING', 'SUCCEEDED'] } },
      select: { id: true },
    });
    if (active) throw notRefundable(subOrderId, 'refund-exists');

    const currency = subOrder.currency;
    if (payment.currency !== currency) {
      throw new DomainError('common.error.internal', { reason: 'payment/sub-order currency' });
    }
    const paid = refundAmount({
      subtotal: toMoney(subOrder.subtotalAmount, currency),
      shipping: toMoney(subOrder.shippingAmount, currency),
      vendorDiscount: toMoney(subOrder.discountAmount, currency),
      platformDiscount: toMoney(subOrder.platformDiscountAmount, currency),
    });

    // Never give back more than the payment captured (sum of its non-FAILED refunds).
    const refunded = await tx.refund.aggregate({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
      _sum: { amount: true },
    });
    if ((refunded._sum.amount ?? 0n) + toDbAmount(paid) > payment.amount) {
      throw new DomainError('common.error.internal', { reason: 'refunds exceed payment' });
    }

    const isFree = Money.isZero(paid);
    const row = await tx.refund.create({
      data: {
        id: ulid(),
        subOrderId,
        paymentId: payment.id,
        amount: toDbAmount(paid),
        currency,
        // Nothing to send back through the provider for a 0 sub-order.
        status: isFree ? 'SUCCEEDED' : 'PENDING',
        reason,
        requestedById: adminId,
      },
    });

    const moved = await tx.subOrder.updateMany({
      where: { id: subOrderId, status: subOrder.status },
      data: { status: 'REFUNDED' },
    });
    if (moved.count !== 1) throw notRefundable(subOrderId, 'status');

    if (STOCK_RETURNED.includes(subOrder.status)) {
      const qtyByVariant = new Map<string, number>();
      for (const item of subOrder.items) {
        qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
      }
      const sorted = [...qtyByVariant].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [variantId, qty] of sorted) {
        await tx.$executeRaw`
          UPDATE product_variants
          SET stock_on_hand = stock_on_hand + ${qty}, updated_at = now()
          WHERE id = ${variantId}`;
      }
    }

    if (!isFree) {
      const txnGroupId = ulid();
      const entries = refundPostings(paid).map((p) => ({
        id: ulid(),
        txnGroupId,
        account: p.account,
        entryType: 'REFUND' as const,
        amount: toDbAmount(p.amount),
        currency,
        orderId: order.id,
        subOrderId,
      }));
      assertZeroSum(entries);
      await tx.ledgerEntry.createMany({ data: entries });
    }

    const statuses = await tx.subOrder.findMany({
      where: { orderId: order.id },
      select: { status: true },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: deriveOrderStatus(statuses.map((s) => s.status)) },
    });

    if (!isFree) {
      const payload: RefundRequestedEvent = RefundRequestedEventSchema.parse({
        refundId: row.id,
        orderId: order.id,
        subOrderId,
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: ORDER_AGGREGATE_TYPE,
          aggregateId: order.id,
          eventType: 'refund.requested',
          payload,
        },
      });
    }

    return toRefund(row);
  }

  async list(query: RefundListQuery): Promise<RefundPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.refund.findMany({
      ...args,
      where: { ...(query.status && { status: query.status }), ...args.where },
      include: { subOrder: { select: { orderId: true, vendorId: true } } },
    });
    const page = toPage(rows, query);
    return RefundPageSchema.parse({
      items: page.items.map(
        (r): RefundListItem =>
          RefundListItemSchema.parse({
            ...toRefund(r),
            orderId: r.subOrder.orderId,
            vendorId: r.subOrder.vendorId,
          }),
      ),
      nextCursor: page.nextCursor,
    });
  }
}
