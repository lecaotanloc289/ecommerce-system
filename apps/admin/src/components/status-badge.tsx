import { Badge, type BadgeProps } from '@repo/ui';
import { useT, type MessageKey } from '@/i18n/use-locale';

type Tone = NonNullable<BadgeProps['variant']>;

/** Every status-like enum value shown in the platform console (application, vendor, product, order, sub-order, payment, refund). */
const STATUSES = {
  PENDING: ['admin.platform.status.pending', 'warning'],
  APPROVED: ['admin.platform.status.approved', 'success'],
  REJECTED: ['admin.platform.status.rejected', 'danger'],
  ACTIVE: ['admin.platform.status.active', 'success'],
  SUSPENDED: ['admin.platform.status.suspended', 'danger'],
  DRAFT: ['admin.platform.status.draft', 'neutral'],
  ARCHIVED: ['admin.platform.status.archived', 'neutral'],
  BLOCKED: ['admin.platform.status.blocked', 'danger'],
  AWAITING_PAYMENT: ['admin.platform.status.awaitingPayment', 'warning'],
  PAID: ['admin.platform.status.paid', 'info'],
  PARTIALLY_REFUNDED: ['admin.platform.status.partiallyRefunded', 'warning'],
  REFUNDED: ['admin.platform.status.refunded', 'neutral'],
  CANCELLED: ['admin.platform.status.cancelled', 'neutral'],
  COMPLETED: ['admin.platform.status.completed', 'success'],
  PROCESSING: ['admin.platform.status.processing', 'info'],
  SHIPPED: ['admin.platform.status.shipped', 'info'],
  DELIVERED: ['admin.platform.status.delivered', 'info'],
  SUCCEEDED: ['admin.platform.status.succeeded', 'success'],
  FAILED: ['admin.platform.status.failed', 'danger'],
  CONFIRMED: ['admin.platform.status.confirmed', 'success'],
} as const satisfies Record<string, readonly [MessageKey, Tone]>;

export type StatusValue = keyof typeof STATUSES;

/** Coloured, translated badge for an API status enum value. */
export function StatusBadge({ status }: { status: StatusValue }) {
  const t = useT();
  const [labelKey, tone] = STATUSES[status];
  return <Badge variant={tone}>{t(labelKey)}</Badge>;
}
