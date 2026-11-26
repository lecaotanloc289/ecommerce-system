import { z } from 'zod';
import { PaymentProviderSchema } from '../enums';
import { AddressIdSchema, ShippingMethodIdSchema } from '../ids';
import { CartLineInputSchema } from './cart';

// Payload sanity bounds only. Business limits (e.g. PlatformSettings.maxCouponStack)
// live in the DB and are enforced by the server, never baked in here.
const MAX_CHECKOUT_LINES = 100;
const MAX_COUPON_CODES = 20;

const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Codes are case-insensitive: normalised (trim + uppercase) so `welcome10` matches `WELCOME10`. */
export const CouponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(64)
  .regex(/^\S+$/, { message: 'Coupon code cannot contain spaces' });
export type CouponCode = z.infer<typeof CouponCodeSchema>;

/**
 * Body of `POST /v1/orders/checkout` (the `Idempotency-Key` travels as a header — see
 * IdempotencyKeySchema). The server splits `items` into one SubOrder per vendor.
 *
 * Shipping is chosen per sub-order by sending one `shippingMethodId` per vendor in the
 * cart. There is deliberately no client `vendorId`: every ShippingMethod belongs to a
 * vendor, so the server resolves the vendor from the DB and rejects a missing/duplicate
 * method per vendor (`checkout.error.shipping-method-missing` / `-invalid`).
 */
export const CheckoutSchema = z.object({
  items: z
    .array(CartLineInputSchema)
    .min(1)
    .max(MAX_CHECKOUT_LINES)
    .refine((items) => isUnique(items.map((i) => i.variantId)), 'Duplicate variantId in items'),
  addressId: AddressIdSchema,
  shippingMethodIds: z
    .array(ShippingMethodIdSchema)
    .min(1)
    .refine(isUnique, 'Duplicate shippingMethodId'),
  couponCodes: z
    .array(CouponCodeSchema)
    .max(MAX_COUPON_CODES)
    .refine(isUnique, 'Duplicate coupon code')
    .default([]),
  provider: PaymentProviderSchema,
  /** Customer agrees to receive order updates from each shop on Zalo (sent to the address phone). */
  zaloOptIn: z.boolean().default(false),
});
export type Checkout = z.infer<typeof CheckoutSchema>;
