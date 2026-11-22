import { type SubOrderStatus, SubOrderStatusSchema } from '../enums';
import { DomainError } from '../errors';

/**
 * Who moves a sub-order (roadmap D11):
 * - `CUSTOMER` — the buyer (cancel unpaid, confirm received)
 * - `VENDOR`   — owner/staff of the sub-order's vendor (accept, ship, deliver)
 * - `PLATFORM` — platform admin (refund, T3.5)
 * - `SYSTEM`   — webhook / jobs (payment confirmed, payment expired, auto-complete)
 */
export const SUB_ORDER_ACTORS = ['CUSTOMER', 'VENDOR', 'PLATFORM', 'SYSTEM'] as const;
export type SubOrderActor = (typeof SUB_ORDER_ACTORS)[number];

/** One allowed edge of the sub-order lifecycle and the actors allowed to take it. */
export interface SubOrderTransition {
  readonly to: SubOrderStatus;
  readonly actors: readonly SubOrderActor[];
}

/**
 * The sub-order state machine (D11) — the ONE place that says which status change is legal.
 * COMPLETED, REFUNDED and CANCELLED are terminal. REFUNDED is reachable from PAID..DELIVERED only
 * (whether the payout already happened is the refund service's check, not a status).
 */
export const SUB_ORDER_TRANSITIONS: Readonly<
  Record<SubOrderStatus, readonly SubOrderTransition[]>
> = {
  AWAITING_PAYMENT: [
    { to: 'PAID', actors: ['SYSTEM'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'SYSTEM'] },
  ],
  PAID: [
    { to: 'PROCESSING', actors: ['VENDOR'] },
    { to: 'REFUNDED', actors: ['PLATFORM'] },
  ],
  PROCESSING: [
    { to: 'SHIPPED', actors: ['VENDOR'] },
    { to: 'REFUNDED', actors: ['PLATFORM'] },
  ],
  SHIPPED: [
    { to: 'DELIVERED', actors: ['VENDOR'] },
    { to: 'COMPLETED', actors: ['CUSTOMER'] },
    { to: 'REFUNDED', actors: ['PLATFORM'] },
  ],
  DELIVERED: [
    { to: 'COMPLETED', actors: ['CUSTOMER', 'SYSTEM'] },
    { to: 'REFUNDED', actors: ['PLATFORM'] },
  ],
  COMPLETED: [],
  REFUNDED: [],
  CANCELLED: [],
};

/** May `actor` move a sub-order from `from` to `to`? Same-status "transitions" are never allowed. */
export function canTransition(
  from: SubOrderStatus,
  to: SubOrderStatus,
  actor: SubOrderActor,
): boolean {
  return SUB_ORDER_TRANSITIONS[from].some((t) => t.to === to && t.actors.includes(actor));
}

/** Throws `order.error.invalid-status-transition` (409) unless `canTransition`. */
export function assertTransition(
  from: SubOrderStatus,
  to: SubOrderStatus,
  actor: SubOrderActor,
): void {
  if (!canTransition(from, to, actor)) {
    throw new DomainError('order.error.invalid-status-transition', { from, to });
  }
}

/** Statuses from which `actor` may move a sub-order to `to` (e.g. COMPLETED by CUSTOMER → SHIPPED, DELIVERED). */
export function transitionSources(to: SubOrderStatus, actor: SubOrderActor): SubOrderStatus[] {
  return SubOrderStatusSchema.options.filter((from) => canTransition(from, to, actor));
}
