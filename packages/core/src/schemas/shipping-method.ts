import { z } from 'zod';
import { ShippingMethodIdSchema, VendorIdSchema } from '../ids';
import { NonNegativeMoneySchema } from './money';

/** Upper bound on estimated delivery days — a payload sanity bound. */
const MAX_EST_DAYS = 60;

export const ShippingMethodSchema = z.object({
  id: ShippingMethodIdSchema,
  vendorId: VendorIdSchema,
  name: z.string().min(1),
  price: NonNegativeMoneySchema,
  estDays: z.number().int().min(1).max(MAX_EST_DAYS),
  isActive: z.boolean(),
});
export type ShippingMethod = z.infer<typeof ShippingMethodSchema>;

/** Create/replace body for a vendor's shipping method; `vendorId` comes from `req.user`. */
export const ShippingMethodInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: NonNegativeMoneySchema,
  estDays: z.number().int().min(1).max(MAX_EST_DAYS),
  isActive: z.boolean().default(true),
});
export type ShippingMethodInput = z.infer<typeof ShippingMethodInputSchema>;
