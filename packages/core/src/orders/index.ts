import type { OrderStatus, SubOrderStatus } from '../enums';
import { DomainError } from '../errors';

/**
 * Order status derived from its sub-orders (roadmap D11). Rules, first match wins:
 *
 * 1. every sub-order CANCELLED        → CANCELLED
 * 2. every sub-order AWAITING_PAYMENT → AWAITING_PAYMENT
 * 3. every sub-order REFUNDED         → REFUNDED
 * 4. some sub-order REFUNDED          → PARTIALLY_REFUNDED
 * 5. every sub-order COMPLETED, ignoring REFUNDED / CANCELLED ones (at least one COMPLETED)
 *                                     → COMPLETED
 * 6. otherwise                        → PAID (money is in escrow, fulfilment in progress)
 *
 * Pure; used by checkout/cancel (T2.1), the payment webhook (T3.1), fulfilment (T3.3) and refunds
 * (T3.5) so the order row always tells the same story. An order always has at least one sub-order.
 */
export function deriveOrderStatus(subOrderStatuses: readonly SubOrderStatus[]): OrderStatus {
  if (subOrderStatuses.length === 0) {
    throw new DomainError('common.error.internal', { reason: 'order without sub-orders' });
  }
  const every = (status: SubOrderStatus): boolean => subOrderStatuses.every((s) => s === status);

  if (every('CANCELLED')) return 'CANCELLED';
  if (every('AWAITING_PAYMENT')) return 'AWAITING_PAYMENT';
  if (every('REFUNDED')) return 'REFUNDED';
  if (subOrderStatuses.includes('REFUNDED')) return 'PARTIALLY_REFUNDED';

  const live = subOrderStatuses.filter((s) => s !== 'REFUNDED' && s !== 'CANCELLED');
  if (live.length > 0 && live.every((s) => s === 'COMPLETED')) return 'COMPLETED';
  return 'PAID';
}
