import { z } from 'zod';
import { CouponScopeSchema } from '../enums';
import { CouponIdSchema, VendorIdSchema } from '../ids';
import { CouponCodeSchema } from './checkout';
import { IsoDateTimeSchema } from './datetime';
import { NonNegativeMoneySchema } from './money';

/** 100% in basis points (same unit as commission_bps). */
const MAX_PERCENT_BPS = 10_000;

/**
 * The discount itself. FIXED carries Money (smallest unit); PERCENT carries basis points
 * (1000 = 10%) — never a float. Apply with `Money.applyBps`.
 */
const FixedDiscountShape = {
  discountType: z.literal('FIXED'),
  discount: NonNegativeMoneySchema.refine((m) => m.amount > 0, 'Discount must be positive'),
};
const PercentDiscountShape = {
  discountType: z.literal('PERCENT'),
  discountBps: z.number().int().min(1).max(MAX_PERCENT_BPS),
};

const ruleShape = {
  code: CouponCodeSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
};

const endsAfterStarts = (v: { startsAt: string; endsAt: string }): boolean =>
  Date.parse(v.endsAt) > Date.parse(v.startsAt);

const sameCurrency = (v: {
  minSpend: { currency: string } | null;
  discount?: { currency: string };
}): boolean =>
  v.minSpend === null || v.discount === undefined || v.minSpend.currency === v.discount.currency;

const inputLimits = {
  /** Order subtotal needed before the coupon applies. */
  minSpend: NonNegativeMoneySchema.nullable().default(null),
  maxRedemptions: z.number().int().positive().nullable().default(null),
  perUserLimit: z.number().int().positive().nullable().default(null),
  isActive: z.boolean().default(true),
};

/**
 * Body of `POST/PUT /v1/vendor/coupons` and `/v1/platform/coupons`. Scope is decided by the
 * endpoint (vendor endpoints force `VENDOR` + `req.user.vendorId`), never by the client.
 * Limits default to unlimited, `isActive` to true.
 */
export const CouponInputSchema = z
  .discriminatedUnion('discountType', [
    z.object({ ...ruleShape, ...inputLimits, ...FixedDiscountShape }),
    z.object({ ...ruleShape, ...inputLimits, ...PercentDiscountShape }),
  ])
  .refine(endsAfterStarts, { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .refine(sameCurrency, { message: 'minSpend currency must match discount', path: ['minSpend'] });
export type CouponInput = z.infer<typeof CouponInputSchema>;

const readShape = {
  id: CouponIdSchema,
  scope: CouponScopeSchema,
  vendorId: VendorIdSchema.nullable(),
  redemptionCount: z.number().int().nonnegative(),
  minSpend: NonNegativeMoneySchema.nullable(),
  maxRedemptions: z.number().int().positive().nullable(),
  perUserLimit: z.number().int().positive().nullable(),
  isActive: z.boolean(),
  ...ruleShape,
};

/** Coupon as returned to its owner (vendor or platform staff). */
export const CouponSchema = z.discriminatedUnion('discountType', [
  z.object({ ...readShape, ...FixedDiscountShape }),
  z.object({ ...readShape, ...PercentDiscountShape }),
]);
export type Coupon = z.infer<typeof CouponSchema>;
