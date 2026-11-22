import { z } from 'zod';
import { RefundStatusSchema } from '../enums';
import { PaymentIdSchema, RefundIdSchema, SubOrderIdSchema, UserIdSchema } from '../ids';
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
