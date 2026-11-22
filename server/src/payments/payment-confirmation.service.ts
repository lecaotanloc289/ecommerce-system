import { Injectable, Logger } from '@nestjs/common';
import {
  computeEscrowInPostings,
  computeRefundPostings,
  deriveOrderStatus,
  DomainError,
  type EscrowPosting,
  Money,
  ORDER_AGGREGATE_TYPE,
  OrderPaidEventSchema,
  type PaymentProvider as PaymentProviderId,
  RefundRequestedEventSchema,
  subOrderPaid,
} from '@repo/core';
import {
  assertZeroSum,
  type Currency,
  type LedgerEntryType,
  type Prisma,
  toDbAmount,
  toMoney,
} from '@repo/db';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** A verified provider result (signature already checked), or a zero-amount confirmation. */
export interface PaymentResultInput {
  provider: PaymentProviderId;
  status: 'CONFIRMED' | 'FAILED';
  paymentId: string;
  providerTxnId: string;
  /** Amount the provider reports (compared with `Payment.amount` + `currency`). */
  amount: Money;
  /** Minimal, PII-free extract of the provider payload for `Payment.rawPayload`. */
  rawPayload: Prisma.InputJsonValue | null;
}

/**
 * - `confirmed`         — payment CONFIRMED, order PAID (escrow IN, stock committed, `order.paid`)
 * - `failed`            — FAILED result recorded on a PENDING payment (order still AWAITING_PAYMENT)
 * - `already-processed` — nothing written: the payment is no longer PENDING for this result
 * - `refund-requested`  — money arrived for a CANCELLED order: CONFIRMED + escrow IN + Refund rows
 * - `manual-review`     — money arrived for an order already paid by another attempt (or whose
 *                         sub-orders already carry a refund): CONFIRMED + escrow IN, logged for a
 *                         manual refund (the Refund table allows one active refund per sub-order)
 * - `not-found`         — no such payment for this provider
 * - `amount-mismatch`   — provider amount/currency ≠ the Payment row (a PENDING one is FAILED)
 */
export type ConfirmationOutcome =
  | 'confirmed'
  | 'failed'
  | 'already-processed'
  | 'refund-requested'
  | 'manual-review'
  | 'not-found'
  | 'amount-mismatch';

/** `Refund.reason` of the automatic refund for a payment that arrived after cancellation. */
export const LATE_PAYMENT_REFUND_REASON = 'payment-after-cancellation';

const TX_OPTIONS = { timeout: 15_000 } as const;

interface LedgerRow {
  id: string;
  txnGroupId: string;
  account: EscrowPosting['account'];
  entryType: LedgerEntryType;
  amount: bigint;
  currency: Currency;
  orderId: string;
  subOrderId: string | null;
}

function ledgerGroup(
  postings: readonly EscrowPosting[],
  entryType: LedgerEntryType,
  orderId: string,
  subOrderId: string | null,
): LedgerRow[] {
  const txnGroupId = ulid();
  return postings.map((p) => ({
    id: ulid(),
    txnGroupId,
    account: p.account,
    entryType,
    amount: toDbAmount(p.amount),
    currency: p.amount.currency,
    orderId,
    subOrderId,
  }));
}

/**
 * Applies a verified payment result (webhook or zero-amount) to the order, in ONE transaction
 * that locks the order row first (same lock as `cancelOrder` / payment retry), then the payment
 * row. Idempotent: replaying a result finds the payment no longer PENDING and writes nothing.
 * See server/CLAUDE.md "Payments" for the full decision table.
 */
@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);

  constructor(private readonly prisma: PrismaService) {}

  apply(input: PaymentResultInput): Promise<ConfirmationOutcome> {
    return this.prisma.client.$transaction((tx) => this.applyInTx(tx, input), TX_OPTIONS);
  }

  /**
   * Confirms a payment of amount 0 (free order: 100% coupons + free shipping) — no provider is
   * involved, so nothing calls a webhook. Same transaction path as a CONFIRMED webhook, with
   * `providerTxnId = paymentId`. The worker's `payment.requested` handler (T3.2) must do the
   * equivalent instead of opening a provider session. Throws `payment.error.amount-mismatch` for
   * a non-zero payment, `order.error.not-found` for an unknown one.
   */
  async confirmZeroAmount(paymentId: string): Promise<ConfirmationOutcome> {
    const payment = await this.prisma.client.payment.findUnique({
      where: { id: paymentId },
      select: { provider: true, amount: true, currency: true },
    });
    if (!payment) throw new DomainError('order.error.not-found');
    if (payment.amount !== 0n) {
      throw new DomainError('payment.error.amount-mismatch', { reason: 'not-zero-amount' });
    }
    return this.apply({
      provider: payment.provider,
      status: 'CONFIRMED',
      paymentId,
      providerTxnId: paymentId,
      amount: Money.zero(payment.currency),
      rawPayload: { zeroAmount: true },
    });
  }

  private async applyInTx(tx: Tx, input: PaymentResultInput): Promise<ConfirmationOutcome> {
    const ref = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true, provider: true },
    });
    if (!ref || ref.provider !== input.provider) return 'not-found';

    // Lock order (first, like cancelOrder / retryPayment), then the payment row.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${ref.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${input.paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: ref.orderId },
      select: { id: true, customerId: true, status: true },
    });

    const expected = toMoney(payment.amount, payment.currency);
    if (!(input.amount.currency === expected.currency && input.amount.amount === expected.amount)) {
      if (payment.status === 'PENDING') {
        await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'FAILED' },
        });
      }
      this.logger.error(
        `payment ${payment.id}: provider amount ${input.amount.amount} ${input.amount.currency} ≠ ` +
          `expected ${expected.amount} ${expected.currency} (status was ${payment.status})`,
      );
      return 'amount-mismatch';
    }

    if (input.status === 'FAILED') {
      if (payment.status !== 'PENDING') return 'already-processed';
      await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      return 'failed';
    }

    // CONFIRMED. A CONFIRMED/REFUNDED payment has been handled before (replay) → no-op.
    if (payment.status !== 'PENDING' && payment.status !== 'FAILED') return 'already-processed';

    // Money is real from here on: the payment becomes CONFIRMED whatever the order state.
    const marked = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'CONFIRMED',
        providerTxnId: input.providerTxnId,
        ...(input.rawPayload !== null && { rawPayload: input.rawPayload }),
      },
    });
    if (marked.count !== 1) throw new Error(`payment ${payment.id} changed under its row lock`);

    if (order.status === 'AWAITING_PAYMENT') {
      await this.markOrderPaid(tx, order, payment.id);
      return 'confirmed';
    }
    if (order.status === 'CANCELLED') {
      return this.refundLatePayment(tx, order, payment.id, expected);
    }
    this.recordUnallocatedPayment(order.id, payment.id, expected, 'order already paid');
    await this.insertLedger(tx, this.orderLevelEscrowIn(order.id, expected));
    return 'manual-review';
  }

  /**
   * Order AWAITING_PAYMENT → PAID. Also used when the confirmed attempt had been marked FAILED
   * (superseded by a retry): the customer paid the order's exact grand total, so the order is
   * paid and the newer PENDING attempt is failed instead of refunding the older one.
   */
  private async markOrderPaid(
    tx: Tx,
    order: { id: string; customerId: string },
    paymentId: string,
  ): Promise<void> {
    await tx.payment.updateMany({
      where: { orderId: order.id, status: 'PENDING', id: { not: paymentId } },
      data: { status: 'FAILED' },
    });

    const subOrders = await tx.subOrder.findMany({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
      include: { items: { select: { variantId: true, quantity: true } } },
    });
    const paid = await tx.subOrder.updateMany({
      where: { orderId: order.id, status: 'AWAITING_PAYMENT' },
      data: { status: 'PAID' },
    });
    if (subOrders.length === 0 || paid.count !== subOrders.length) {
      throw new Error(`markOrderPaid: sub-orders of ${order.id} are not all AWAITING_PAYMENT`);
    }

    await this.commitStock(
      tx,
      order.id,
      subOrders.flatMap((so) => so.items),
    );

    const ledger = subOrders.flatMap((so) => {
      const amount = this.paidOf(so);
      return Money.isZero(amount)
        ? []
        : ledgerGroup(computeEscrowInPostings(amount), 'ESCROW_IN', order.id, so.id);
    });
    await this.insertLedger(tx, ledger);

    await tx.order.update({
      where: { id: order.id },
      data: { status: deriveOrderStatus(subOrders.map(() => 'PAID' as const)) },
    });
    await tx.outboxEvent.create({
      data: {
        id: ulid(),
        aggregateType: ORDER_AGGREGATE_TYPE,
        aggregateId: order.id,
        eventType: 'order.paid',
        payload: OrderPaidEventSchema.parse({ orderId: order.id, customerId: order.customerId }),
      },
    });
  }

  /**
   * D4 "paid": `stock_on_hand -= qty, stock_reserved -= qty` per variant, in variant-id order
   * (same order as checkout / cancel → no deadlocks). Guarded so neither counter goes negative;
   * if the guard fails (a counter was edited below the reservation — should not happen, vendor
   * stock edits refuse to go below `stock_reserved`) the payment is still confirmed, the
   * counters are clamped at 0 and the variant is logged for a manual stock check.
   */
  private async commitStock(
    tx: Tx,
    orderId: string,
    items: readonly { variantId: string; quantity: number }[],
  ): Promise<void> {
    const qtyByVariant = new Map<string, number>();
    for (const item of items) {
      qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) ?? 0) + item.quantity);
    }
    const sorted = [...qtyByVariant].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [variantId, qty] of sorted) {
      const updated = await tx.$executeRaw`
        UPDATE product_variants
        SET stock_on_hand = stock_on_hand - ${qty},
            stock_reserved = stock_reserved - ${qty},
            updated_at = now()
        WHERE id = ${variantId} AND stock_on_hand >= ${qty} AND stock_reserved >= ${qty}`;
      if (updated === 1) continue;
      this.logger.error(
        `order ${orderId}: variant ${variantId} stock below the paid quantity ${qty}; ` +
          'counters clamped at 0 — check stock manually',
      );
      await tx.$executeRaw`
        UPDATE product_variants
        SET stock_on_hand = GREATEST(stock_on_hand - ${qty}, 0),
            stock_reserved = GREATEST(stock_reserved - ${qty}, 0),
            updated_at = now()
        WHERE id = ${variantId}`;
    }
  }

  /**
   * Money arrived for a CANCELLED order (paid after the customer cancelled or the deadline
   * expired; stock and coupons were already released). Nothing was escrowed at cancel time, so
   * per paid sub-order: escrow IN (`ESCROW_IN` group), a PENDING `Refund` of `paid_i`
   * (requestedBy = the customer, reason `payment-after-cancellation`), the refund postings
   * (`REFUND` group, as T3.5 does) and outbox `refund.requested`. Sub-orders and the order stay
   * CANCELLED. If any sub-order already has an active refund (an earlier late payment), the
   * money goes to `manual-review` instead — the DB allows one active refund per sub-order.
   */
  private async refundLatePayment(
    tx: Tx,
    order: { id: string; customerId: string },
    paymentId: string,
    amount: Money,
  ): Promise<ConfirmationOutcome> {
    const subOrders = await tx.subOrder.findMany({
      where: { orderId: order.id },
      orderBy: { id: 'asc' },
    });
    const active = await tx.refund.count({
      where: { subOrderId: { in: subOrders.map((so) => so.id) }, status: { not: 'FAILED' } },
    });
    const shares = subOrders.map((so) => ({ so, paid: this.paidOf(so) }));
    const total = Money.sum(
      shares.map((s) => s.paid),
      amount.currency,
    );
    if (active > 0 || !Money.equals(total, amount)) {
      this.recordUnallocatedPayment(
        order.id,
        paymentId,
        amount,
        active > 0 ? 'cancelled order already has a refund' : 'sub-order totals ≠ payment',
      );
      await this.insertLedger(tx, this.orderLevelEscrowIn(order.id, amount));
      return 'manual-review';
    }

    const ledger: LedgerRow[] = [];
    for (const { so, paid } of shares) {
      if (Money.isZero(paid)) continue;
      const refundId = ulid();
      // ON CONFLICT on the partial unique index (one non-FAILED refund per sub-order): a refund
      // written concurrently without the order lock makes this insert a no-op → roll back, the
      // provider retries and lands in manual-review.
      const inserted = await tx.$executeRaw`
        INSERT INTO refunds (id, sub_order_id, payment_id, amount, currency, status, reason,
                             requested_by_id, created_at, updated_at)
        VALUES (${refundId}, ${so.id}, ${paymentId}, ${toDbAmount(paid)},
                ${paid.currency}::"Currency", 'PENDING'::"RefundStatus",
                ${LATE_PAYMENT_REFUND_REASON}, ${order.customerId}, now(), now())
        ON CONFLICT (sub_order_id) WHERE status <> 'FAILED' DO NOTHING`;
      if (inserted !== 1) throw new Error(`sub-order ${so.id} got a refund concurrently`);
      ledger.push(
        ...ledgerGroup(computeEscrowInPostings(paid), 'ESCROW_IN', order.id, so.id),
        ...ledgerGroup(computeRefundPostings(paid), 'REFUND', order.id, so.id),
      );
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          aggregateType: ORDER_AGGREGATE_TYPE,
          aggregateId: order.id,
          eventType: 'refund.requested',
          payload: RefundRequestedEventSchema.parse({
            refundId,
            orderId: order.id,
            subOrderId: so.id,
          }),
        },
      });
    }
    await this.insertLedger(tx, ledger);
    this.logger.warn(
      `payment ${paymentId} arrived for cancelled order ${order.id}: refund requested`,
    );
    return 'refund-requested';
  }

  /** Escrow IN for money not tied to a sub-order (duplicate payment); skipped for 0. */
  private orderLevelEscrowIn(orderId: string, amount: Money): LedgerRow[] {
    if (Money.isZero(amount)) return [];
    return ledgerGroup(computeEscrowInPostings(amount), 'ESCROW_IN', orderId, null);
  }

  private recordUnallocatedPayment(
    orderId: string,
    paymentId: string,
    amount: Money,
    reason: string,
  ): void {
    this.logger.error(
      `payment ${paymentId} (${amount.amount} ${amount.currency}) confirmed for order ${orderId} ` +
        `but not applied (${reason}): held in escrow, refund it manually`,
    );
  }

  private paidOf(so: {
    currency: Currency;
    subtotalAmount: bigint;
    shippingAmount: bigint;
    discountAmount: bigint;
    platformDiscountAmount: bigint;
  }): Money {
    return subOrderPaid({
      subtotal: toMoney(so.subtotalAmount, so.currency),
      shipping: toMoney(so.shippingAmount, so.currency),
      vendorDiscount: toMoney(so.discountAmount, so.currency),
      platformDiscount: toMoney(so.platformDiscountAmount, so.currency),
    });
  }

  private async insertLedger(tx: Tx, rows: LedgerRow[]): Promise<void> {
    if (rows.length === 0) return;
    assertZeroSum(rows);
    await tx.ledgerEntry.createMany({ data: rows });
  }
}
