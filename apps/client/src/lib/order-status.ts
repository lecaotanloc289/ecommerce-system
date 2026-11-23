import type { OrderStatus, SubOrder, SubOrderStatus } from '@repo/core';

/** Forward path shown as the stepper (a sub-order is PAID once the payment is confirmed). */
export const TIMELINE_STAGES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'] as const;
export type TimelineStage = (typeof TIMELINE_STAGES)[number];

export interface TimelineStep {
  stage: TimelineStage;
  state: 'done' | 'current' | 'upcoming';
  /** ISO time when the API records one (shipped / delivered / completed); null otherwise. */
  at: string | null;
}

export interface SubOrderTimeline {
  steps: TimelineStep[];
  /** Sub-order that left the forward path. */
  terminal: 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED' | null;
  /** Timestamp of the terminal state (cancellation), if any. */
  terminalAt: string | null;
}

const STAGE_INDEX: Partial<Record<SubOrderStatus, number>> = {
  PAID: 0,
  PROCESSING: 1,
  SHIPPED: 2,
  DELIVERED: 3,
  COMPLETED: 4,
};

type TimelineSource = Pick<
  SubOrder,
  'status' | 'shippedAt' | 'deliveredAt' | 'completedAt' | 'cancelledAt'
>;

function stageTime(sub: TimelineSource, stage: TimelineStage): string | null {
  switch (stage) {
    case 'SHIPPED':
      return sub.shippedAt;
    case 'DELIVERED':
      return sub.deliveredAt;
    case 'COMPLETED':
      return sub.completedAt;
    default:
      return null;
  }
}

/**
 * Status timeline of one sub-order from its status + timestamps. A COMPLETED sub-order has
 * every step done; a step before the current one is done; later steps are upcoming. Awaiting
 * payment / cancelled / refunded sub-orders have no active step (`terminal` says why).
 */
export function subOrderTimeline(sub: TimelineSource): SubOrderTimeline {
  const index = STAGE_INDEX[sub.status];
  const terminal =
    sub.status === 'AWAITING_PAYMENT' || sub.status === 'CANCELLED' || sub.status === 'REFUNDED'
      ? sub.status
      : null;
  const steps = TIMELINE_STAGES.map((stage, i): TimelineStep => {
    const at = stageTime(sub, stage);
    if (index === undefined) return { stage, state: 'upcoming', at };
    // COMPLETED is the last step: nothing is "in progress" after it.
    if (i < index || (i === index && sub.status === 'COMPLETED')) {
      return { stage, state: 'done', at };
    }
    return { stage, state: i === index ? 'current' : 'upcoming', at };
  });
  return { steps, terminal, terminalAt: terminal === 'CANCELLED' ? sub.cancelledAt : null };
}

/** What the success page tells the customer about an order. */
export type PaymentOutcome = 'paid' | 'pending' | 'cancelled';

const PAID_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'COMPLETED',
]);

export function paymentOutcome(status: OrderStatus): PaymentOutcome {
  if (PAID_STATUSES.has(status)) return 'paid';
  return status === 'CANCELLED' ? 'cancelled' : 'pending';
}

/** Polling the order after a VNPay return can stop: it is paid or cancelled (terminal). */
export function isPaymentSettled(status: OrderStatus): boolean {
  return paymentOutcome(status) !== 'pending';
}

interface OrderActionsSource {
  status: OrderStatus;
  subOrders: readonly Pick<SubOrder, 'status'>[];
}

/** The whole order can be cancelled only while every sub-order awaits payment. */
export function canCancelOrder(order: OrderActionsSource): boolean {
  return (
    order.status === 'AWAITING_PAYMENT' &&
    order.subOrders.length > 0 &&
    order.subOrders.every((s) => s.status === 'AWAITING_PAYMENT')
  );
}

/** Pay (again) while the order still awaits payment. */
export function canPayOrder(order: OrderActionsSource): boolean {
  return canCancelOrder(order);
}

/** "Mark as received" is offered for shipped / delivered sub-orders. */
export function canConfirmReceived(sub: Pick<SubOrder, 'status'>): boolean {
  return sub.status === 'SHIPPED' || sub.status === 'DELIVERED';
}
