import type { ProductStatus, SubOrderStatus, VendorInvitationStatus } from '@repo/core';
import { StatusPill, type StatusTone } from '@/components/status-badge';
import { useT } from '@/i18n/use-locale';

const PRODUCT_TONE: Record<ProductStatus, StatusTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  ARCHIVED: 'warning',
  BLOCKED: 'danger',
};

const ORDER_TONE: Record<SubOrderStatus, StatusTone> = {
  AWAITING_PAYMENT: 'neutral',
  PAID: 'warning',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  COMPLETED: 'success',
  REFUNDED: 'danger',
  CANCELLED: 'neutral',
};

const INVITATION_TONE: Record<VendorInvitationStatus, StatusTone> = {
  PENDING: 'info',
  ACCEPTED: 'success',
  REVOKED: 'neutral',
  EXPIRED: 'warning',
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const t = useT();
  return (
    <StatusPill tone={PRODUCT_TONE[status]}>{t(`admin.vendor.productStatus.${status}`)}</StatusPill>
  );
}

export function OrderStatusBadge({ status }: { status: SubOrderStatus }) {
  const t = useT();
  return (
    <StatusPill tone={ORDER_TONE[status]}>{t(`admin.vendor.orderStatus.${status}`)}</StatusPill>
  );
}

export function InvitationStatusBadge({ status }: { status: VendorInvitationStatus }) {
  const t = useT();
  return (
    <StatusPill tone={INVITATION_TONE[status]}>
      {t(`admin.vendor.invitationStatus.${status}`)}
    </StatusPill>
  );
}
