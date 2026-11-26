import { z } from 'zod';
import { RefundStatusSchema } from '../enums';
import {
  OrderIdSchema,
  PaymentIdSchema,
  RefundIdSchema,
  SubOrderIdSchema,
  UserIdSchema,
  VendorIdSchema,
} from '../ids';
import { PageQuerySchema, PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { NonNegativeMoneySchema } from './money';

/**
 * Body of `POST /v1/platform/sub-orders/:id/refund` (admin). MVP refunds the whole sub-order,
 * so there is no amount — the server uses the sub-order's paid total.
 */
export const RefundCreateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RefundCreate = z.infer<typeof RefundCreateSchema>;

export const RefundSchema = z.object({
  id: RefundIdSchema,
  subOrderId: SubOrderIdSchema,
  paymentId: PaymentIdSchema,
  amount: NonNegativeMoneySchema,
  status: RefundStatusSchema,
  reason: z.string(),
  providerRefundId: z.string().nullable(),
  requestedById: UserIdSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Refund = z.infer<typeof RefundSchema>;

/** `GET /v1/platform/refunds?status=&cursor=&limit=` (platform console), newest first. */
export const RefundListQuerySchema = PageQuerySchema.extend({
  status: RefundStatusSchema.optional(),
});
export type RefundListQuery = z.infer<typeof RefundListQuerySchema>;

/** Console row: the refund plus the order and vendor it belongs to (for linking). */
export const RefundListItemSchema = RefundSchema.extend({
  orderId: OrderIdSchema,
  vendorId: VendorIdSchema,
});
export type RefundListItem = z.infer<typeof RefundListItemSchema>;

export const RefundPageSchema = PageSchema(RefundListItemSchema);
export type RefundPage = z.infer<typeof RefundPageSchema>;
