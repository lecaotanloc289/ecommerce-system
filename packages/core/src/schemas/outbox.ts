import { z } from 'zod';
import { PaymentProviderSchema } from '../enums';
import {
  OrderIdSchema,
  PaymentIdSchema,
  UserIdSchema,
  VendorApplicationIdSchema,
  VendorIdSchema,
  VendorInvitationIdSchema,
} from '../ids';

// Payloads of `outbox_events` rows (Golden Rule #9). Written by the API inside the business
// transaction, consumed by the worker (`@workers/jobs`). Payloads carry ids only (+ the provider):
// handlers re-read current state from the DB, so a payload never goes stale or leaks money data.
// Every order event uses `aggregateType = 'order'` and `aggregateId = orderId`.

export const ORDER_AGGREGATE_TYPE = 'order';

/** `order.created` — checkout committed (customer email: "order received"). */
export const OrderCreatedEventSchema = z.object({
  orderId: OrderIdSchema,
  customerId: UserIdSchema,
});
export type OrderCreatedEvent = z.infer<typeof OrderCreatedEventSchema>;

/**
 * `payment.requested` — a Payment attempt is PENDING without a provider session; the worker calls
 * `PaymentProvider.createSession` and writes `Payment.redirectUrl` / `expiresAt` (roadmap D2).
 * Skip it when the payment is no longer PENDING.
 */
export const PaymentRequestedEventSchema = z.object({
  orderId: OrderIdSchema,
  paymentId: PaymentIdSchema,
  provider: PaymentProviderSchema,
  attemptNo: z.number().int().positive(),
});
export type PaymentRequestedEvent = z.infer<typeof PaymentRequestedEventSchema>;

/** Why an unpaid order was cancelled: by the customer, or by the payment-expiry job (T3.2). */
export const OrderCancelReasonSchema = z.enum(['CUSTOMER', 'PAYMENT_EXPIRED']);
export type OrderCancelReason = z.infer<typeof OrderCancelReasonSchema>;

/** `order.cancelled` — every sub-order went AWAITING_PAYMENT → CANCELLED, stock released. */
export const OrderCancelledEventSchema = z.object({
  orderId: OrderIdSchema,
  customerId: UserIdSchema,
  reason: OrderCancelReasonSchema,
});
export type OrderCancelledEvent = z.infer<typeof OrderCancelledEventSchema>;

export const VENDOR_APPLICATION_AGGREGATE_TYPE = 'vendor-application';

/** `vendor.application.approved` — vendor + wallet + VENDOR_OWNER role created (aggregateId = applicationId). */
export const VendorApplicationApprovedEventSchema = z.object({
  applicationId: VendorApplicationIdSchema,
  vendorId: VendorIdSchema,
  userId: UserIdSchema,
});
export type VendorApplicationApprovedEvent = z.infer<typeof VendorApplicationApprovedEventSchema>;

/** `vendor.application.rejected` (aggregateId = applicationId). */
export const VendorApplicationRejectedEventSchema = z.object({
  applicationId: VendorApplicationIdSchema,
  userId: UserIdSchema,
});
export type VendorApplicationRejectedEvent = z.infer<typeof VendorApplicationRejectedEventSchema>;

export const VENDOR_INVITATION_AGGREGATE_TYPE = 'vendor-invitation';

/**
 * `vendor.invitation.created` (aggregateId = invitationId). UNLIKE every other payload this one
 * carries a secret: the raw invitation `token` (only its sha256 is stored in
 * `vendor_invitations`), needed for the `ADMIN_ORIGIN/invite?token=` email link. The worker must
 * scrub `token` from the row's payload once the email is sent (or the event is dead-lettered)
 * and must never log it.
 */
export const VendorInvitationCreatedEventSchema = z.object({
  invitationId: VendorInvitationIdSchema,
  vendorId: VendorIdSchema,
  email: z.string(),
  token: z.string(),
});
export type VendorInvitationCreatedEvent = z.infer<typeof VendorInvitationCreatedEventSchema>;

/** Event type → payload schema, for the dispatcher's handler table. */
export const OUTBOX_EVENT_SCHEMAS = {
  'order.created': OrderCreatedEventSchema,
  'payment.requested': PaymentRequestedEventSchema,
  'order.cancelled': OrderCancelledEventSchema,
  'vendor.application.approved': VendorApplicationApprovedEventSchema,
  'vendor.application.rejected': VendorApplicationRejectedEventSchema,
  'vendor.invitation.created': VendorInvitationCreatedEventSchema,
} as const;
export type OutboxEventType = keyof typeof OUTBOX_EVENT_SCHEMAS;
