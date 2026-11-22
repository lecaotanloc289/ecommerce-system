import { Injectable } from '@nestjs/common';
import {
  DomainError,
  ORDER_AGGREGATE_TYPE,
  type Order,
  type OrderSummaryPage,
  OrderSummaryPageSchema,
  type PageQuery,
  type PaymentRetry,
  type PaymentSession,
  PaymentRequestedEventSchema,
} from '@repo/core';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { cancelOrder } from './order-cancellation';
import {
  ORDER_DETAIL_ARGS,
  ORDER_SUMMARY_ARGS,
  toOrder,
  toOrderSummary,
  toPaymentSession,
} from './order-view';

/** `ready: false` = the latest attempt is PENDING and the worker has not created its session yet (→ 202). */
export interface PaymentSessionView {
  session: PaymentSession;
  ready: boolean;
}

/**
 * Customer side of orders: history, detail, payment session polling, cancel, payment retry.
 * Every query is scoped by `customerId = req.user.id`; another user's order is 404, never 403.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: PageQuery): Promise<OrderSummaryPage> {
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.order.findMany({
      ...args,
      where: { customerId: userId, ...args.where },
      ...ORDER_SUMMARY_ARGS,
    });
    const page = toPage(rows, query);
    return OrderSummaryPageSchema.parse({
      items: page.items.map(toOrderSummary),
      nextCursor: page.nextCursor,
    });
  }

  async get(userId: string, orderId: string): Promise<Order> {
    const row = await this.prisma.client.order.findFirst({
      where: { id: orderId, customerId: userId },
      ...ORDER_DETAIL_ARGS,
    });
    if (!row) throw new DomainError('order.error.not-found');
    return toOrder(row);
  }

  /** Session of the latest payment attempt (clients poll this after checkout, roadmap D2). */
  async getPaymentSession(userId: string, orderId: string): Promise<PaymentSessionView> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { orderId, order: { customerId: userId } },
      orderBy: { attemptNo: 'desc' },
      select: { status: true, redirectUrl: true, expiresAt: true },
    });
    if (!payment) throw new DomainError('order.error.not-found');
    return {
      session: toPaymentSession(payment),
      ready: !(payment.status === 'PENDING' && payment.redirectUrl === null),
    };
  }

  /** Customer cancel: only while every sub-order is AWAITING_PAYMENT (see `cancelOrder`). */
  async cancel(userId: string, orderId: string): Promise<Order> {
    await this.prisma.client.$transaction(async (tx) => {
      const owned = await tx.order.findFirst({
        where: { id: orderId, customerId: userId },
        select: { id: true },
      });
      if (!owned) throw new DomainError('order.error.not-found');
      const result = await cancelOrder(tx, orderId, 'CUSTOMER');
      if (result === 'not-found') throw new DomainError('order.error.not-found');
      if (result === 'not-cancellable') {
        throw new DomainError('order.error.invalid-status-transition');
      }
    });
    return this.get(userId, orderId);
  }

  /**
   * New payment attempt (`attemptNo + 1`, PENDING, no session) + outbox `payment.requested`.
   * Allowed while the order is AWAITING_PAYMENT, its `paymentDeadlineAt` has not passed and the
   * latest attempt is FAILED or PENDING past its `expiresAt` (that attempt is marked FAILED first,
   * so at most one attempt is ever PENDING). The order row is locked, so concurrent retries and
   * a concurrent cancel serialise; `(order_id, attempt_no)` is unique as a backstop.
   */
  async retryPayment(
    userId: string,
    orderId: string,
    input: PaymentRetry,
  ): Promise<PaymentSession> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM orders WHERE id = ${orderId} AND customer_id = ${userId} FOR UPDATE`;
      if (locked.length === 0) throw new DomainError('order.error.not-found');

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: {
          status: true,
          currency: true,
          grandTotalAmount: true,
          paymentDeadlineAt: true,
          payments: { orderBy: { attemptNo: 'desc' }, take: 1 },
        },
      });
      const now = new Date();
      if (order.status !== 'AWAITING_PAYMENT') {
        throw new DomainError('order.error.invalid-status-transition');
      }
      if (order.paymentDeadlineAt !== null && order.paymentDeadlineAt <= now) {
        throw new DomainError('payment.error.retry-not-allowed', { reason: 'deadline-passed' });
      }
      const latest = order.payments[0];
      if (!latest) throw new Error(`order ${orderId} has no payment attempt`);
      if (latest.status === 'PENDING') {
        const expired = latest.expiresAt !== null && latest.expiresAt < now;
        if (!expired) {
          throw new DomainError('payment.error.retry-not-allowed', { reason: 'payment-pending' });
        }
        await tx.payment.updateMany({
          where: { id: latest.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      } else if (latest.status !== 'FAILED') {
        throw new DomainError('order.error.invalid-status-transition');
      }

      const provider = input.provider ?? latest.provider;
      const attemptNo = latest.attemptNo + 1;
      const payment = await tx.payment.create({
        data: {
          id: ulid(),
          orderId,
          provider,
          status: 'PENDING',
          attemptNo,
          amount: order.grandTotalAmount,
          currency: order.currency,
        },
      });
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: ORDER_AGGREGATE_TYPE,
          aggregateId: orderId,
          eventType: 'payment.requested',
          payload: PaymentRequestedEventSchema.parse({
            orderId,
            paymentId: payment.id,
            provider,
            attemptNo,
          }),
        },
      });
      return toPaymentSession(payment);
    });
  }
}
