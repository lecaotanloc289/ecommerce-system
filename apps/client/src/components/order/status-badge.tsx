'use client';

import { Badge } from '@repo/ui';
import type { OrderStatus, SubOrderStatus } from '@repo/core';
import { useT, type MessageKey } from '../../i18n/use-locale';

type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info';

const ORDER: Record<OrderStatus, { label: MessageKey; tone: Tone }> = {
  AWAITING_PAYMENT: { label: 'orders.status.awaitingPayment', tone: 'warning' },
  PAID: { label: 'orders.status.paid', tone: 'info' },
  PARTIALLY_REFUNDED: { label: 'orders.status.partiallyRefunded', tone: 'warning' },
  REFUNDED: { label: 'orders.status.refunded', tone: 'neutral' },
  CANCELLED: { label: 'orders.status.cancelled', tone: 'danger' },
  COMPLETED: { label: 'orders.status.completed', tone: 'success' },
};

const SUB_ORDER: Record<SubOrderStatus, { label: MessageKey; tone: Tone }> = {
  AWAITING_PAYMENT: { label: 'orders.status.awaitingPayment', tone: 'warning' },
  PAID: { label: 'orders.status.paid', tone: 'info' },
  PROCESSING: { label: 'orders.status.processing', tone: 'info' },
  SHIPPED: { label: 'orders.status.shipped', tone: 'brand' },
  DELIVERED: { label: 'orders.status.delivered', tone: 'brand' },
  COMPLETED: { label: 'orders.status.completed', tone: 'success' },
  REFUNDED: { label: 'orders.status.refunded', tone: 'neutral' },
  CANCELLED: { label: 'orders.status.cancelled', tone: 'danger' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useT();
  const { label, tone } = ORDER[status];
  return (
    <Badge variant={tone} size="lg">
      {t(label)}
    </Badge>
  );
}

export function SubOrderStatusBadge({ status }: { status: SubOrderStatus }) {
  const t = useT();
  const { label, tone } = SUB_ORDER[status];
  return (
    <Badge variant={tone} size="lg">
      {t(label)}
    </Badge>
  );
}

/** Short, readable order number from the ULID (its last 8 characters). */
export function shortOrderId(orderId: string): string {
  return `#${orderId.slice(-8)}`;
}
