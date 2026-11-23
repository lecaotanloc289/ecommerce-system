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
import { queueZaloStatusMessages } from '../zalo/zalo-message-queue';

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

    const payment = await this.salePayment(tx, order.id, subOrderId);
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
    await queueZaloStatusMessages(tx, [subOrderId], 'REFUNDED', new Date());

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

  /**
   * The CONFIRMED payment that paid for the sale. An order can hold more than one CONFIRMED
   * payment (a duplicate lands in manual review and stays CONFIRMED), so pick, among those whose
   * amount + currency equal the order's grand total, the one **confirmed first**: the first
   * confirmation paid the order, any later one went to manual review. Confirmation time =
   * `updatedAt` — a CONFIRMED row is written only by its confirmation (every other payment update
   * targets PENDING rows, and CONFIRMED → REFUNDED leaves this set). Not `attemptNo`: a late
   * payment of an older attempt is the duplicate. Interim rule until payments record which one
   * the order consumed (needs a migration). No exact match → latest CONFIRMED attempt + warning.
   */
  private async salePayment(tx: Tx, orderId: string, subOrderId: string) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { grandTotalAmount: true, currency: true },
    });
    const confirmed = await tx.payment.findMany({
      where: { orderId, status: 'CONFIRMED' },
      orderBy: [{ updatedAt: 'asc' }, { attemptNo: 'asc' }],
    });
    const exact = confirmed.find(
      (p) => p.amount === order.grandTotalAmount && p.currency === order.currency,
    );
    if (exact) return exact;
    const latest = confirmed.reduce<(typeof confirmed)[number] | null>(
      (best, p) => (best === null || p.attemptNo > best.attemptNo ? p : best),
      null,
    );
    if (latest) {
      this.logger.warn(
        { orderId, subOrderId, paymentId: latest.id, confirmed: confirmed.length },
        'no CONFIRMED payment equals the order total; refunding against the latest attempt',
      );
    }
    return latest;
  }

  /**
   * `POST /v1/platform/refunds/:id/retry` — the recovery path for a provider refund that FAILED.
   * The bookkeeping (sub-order REFUNDED, stock, ledger `PLATFORM_ESCROW → CUSTOMER`) was done by
   * the original refund and stays as is; this only asks the provider again through a NEW PENDING
   * Refund row (new id = new provider idempotency id) + `refund.requested`. Never touches the ledger.
   */
  async retryRefund(adminId: string, refundId: string): Promise<Refund> {
    try {
      const refund = await this.prisma.client.$transaction(
        (tx) => this.retryInTx(tx, adminId, refundId),
        { timeout: REFUND_TX_TIMEOUT_MS },
      );
      this.logger.log({ refundId: refund.id, retryOf: refundId, adminId }, 'refund retried');
      return refund;
    } catch (error) {
      // Backstop: `refunds_sub_order_id_active_key` (one non-FAILED refund per sub-order).
      if (isUniqueViolation(error)) {
        const failed = await this.prisma.client.refund.findUnique({
          where: { id: refundId },
          select: { subOrderId: true },
        });
        throw notRefundable(failed?.subOrderId ?? refundId, 'refund-exists');
      }
      throw error;
    }
  }

  /**
   * 1. Lock the ORDER row (same first lock as every order writer), then the refund row.
   * 2. Retryable iff the refund is FAILED, its sub-order is REFUNDED (admin refund) or CANCELLED
   *    in a CANCELLED order (late-payment refund), and the sub-order has no PENDING/SUCCEEDED
   *    refund; Σ non-FAILED refunds of the payment + this amount must stay ≤ the payment.
   * 3. New PENDING Refund (same amount / currency / payment / sub-order, `requestedById` = admin,
   *    reason references the failed one) + outbox `refund.requested`.
   */
  private async retryInTx(tx: Tx, adminId: string, refundId: string): Promise<Refund> {
    const orders = await tx.$queryRaw<{ id: string; customer_id: string; status: string }[]>`
      SELECT o.id, o.customer_id, o.status::text AS status
      FROM orders o
      JOIN sub_orders s ON s.order_id = o.id
      JOIN refunds r ON r.sub_order_id = s.id
      WHERE r.id = ${refundId}
      FOR UPDATE OF o`;
    const order = orders[0];
    if (!order) throw new DomainError('common.error.not-found', { id: refundId });
    await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId} FOR UPDATE`;

    if (order.customer_id === adminId) throw new DomainError('common.error.forbidden');

    const failed = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { subOrder: { select: { status: true } } },
    });
    const { subOrderId } = failed;
    if (failed.status !== 'FAILED') throw notRefundable(subOrderId, 'refund-not-failed');
    const lateRefund = order.status === 'CANCELLED' && failed.subOrder.status === 'CANCELLED';
    if (failed.subOrder.status !== 'REFUNDED' && !lateRefund) {
      throw notRefundable(subOrderId, 'status');
    }

    const active = await tx.refund.findFirst({
      where: { subOrderId, status: { in: ['PENDING', 'SUCCEEDED'] } },
      select: { id: true },
    });
    if (active) throw notRefundable(subOrderId, 'refund-exists');

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: failed.paymentId } });
    const refunded = await tx.refund.aggregate({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
      _sum: { amount: true },
    });
    if ((refunded._sum.amount ?? 0n) + failed.amount > payment.amount) {
      throw new DomainError('common.error.internal', { reason: 'refunds exceed payment' });
    }

    const row = await tx.refund.create({
      data: {
        id: ulid(),
        subOrderId,
        paymentId: failed.paymentId,
        amount: failed.amount,
        currency: failed.currency,
        status: 'PENDING',
        reason: `retry of refund ${failed.id}`,
        requestedById: adminId,
      },
    });

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
