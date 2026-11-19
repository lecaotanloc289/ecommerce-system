import { z } from 'zod';

/**
 * Nominal ("branded") type: `Brand<string, 'OrderId'>` is a string that cannot be
 * passed where a `Brand<string, 'UserId'>` is expected. Built on Zod's brand marker so
 * `XxxIdSchema.parse(raw)` returns exactly this type — no casts needed anywhere.
 */
export type Brand<T, Name extends string> = T & z.$brand<Name>;

/**
 * Canonical ULID as produced by the `ulid` package: 26 chars of uppercase Crockford
 * base32 (no I, L, O, U), first char 0-7 so the 48-bit timestamp cannot overflow.
 * Lowercase is rejected on purpose — IDs are compared as plain text in Postgres.
 */
export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const UlidSchema = z.string().regex(ULID_REGEX, { message: 'Invalid ULID' });
export type Ulid = z.infer<typeof UlidSchema>;

export const UserIdSchema = UlidSchema.brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;

export const OAuthIdentityIdSchema = UlidSchema.brand<'OAuthIdentityId'>();
export type OAuthIdentityId = z.infer<typeof OAuthIdentityIdSchema>;

export const AddressIdSchema = UlidSchema.brand<'AddressId'>();
export type AddressId = z.infer<typeof AddressIdSchema>;

export const VendorIdSchema = UlidSchema.brand<'VendorId'>();
export type VendorId = z.infer<typeof VendorIdSchema>;

export const VendorApplicationIdSchema = UlidSchema.brand<'VendorApplicationId'>();
export type VendorApplicationId = z.infer<typeof VendorApplicationIdSchema>;

export const WalletIdSchema = UlidSchema.brand<'WalletId'>();
export type WalletId = z.infer<typeof WalletIdSchema>;

export const CategoryIdSchema = UlidSchema.brand<'CategoryId'>();
export type CategoryId = z.infer<typeof CategoryIdSchema>;

export const ProductIdSchema = UlidSchema.brand<'ProductId'>();
export type ProductId = z.infer<typeof ProductIdSchema>;

export const ProductVariantIdSchema = UlidSchema.brand<'ProductVariantId'>();
export type ProductVariantId = z.infer<typeof ProductVariantIdSchema>;

export const ProductImageIdSchema = UlidSchema.brand<'ProductImageId'>();
export type ProductImageId = z.infer<typeof ProductImageIdSchema>;

export const CartIdSchema = UlidSchema.brand<'CartId'>();
export type CartId = z.infer<typeof CartIdSchema>;

export const CartItemIdSchema = UlidSchema.brand<'CartItemId'>();
export type CartItemId = z.infer<typeof CartItemIdSchema>;

export const OrderIdSchema = UlidSchema.brand<'OrderId'>();
export type OrderId = z.infer<typeof OrderIdSchema>;

export const SubOrderIdSchema = UlidSchema.brand<'SubOrderId'>();
export type SubOrderId = z.infer<typeof SubOrderIdSchema>;

export const OrderItemIdSchema = UlidSchema.brand<'OrderItemId'>();
export type OrderItemId = z.infer<typeof OrderItemIdSchema>;

export const ShippingMethodIdSchema = UlidSchema.brand<'ShippingMethodId'>();
export type ShippingMethodId = z.infer<typeof ShippingMethodIdSchema>;

export const PaymentIdSchema = UlidSchema.brand<'PaymentId'>();
export type PaymentId = z.infer<typeof PaymentIdSchema>;

export const LedgerEntryIdSchema = UlidSchema.brand<'LedgerEntryId'>();
export type LedgerEntryId = z.infer<typeof LedgerEntryIdSchema>;

export const CouponIdSchema = UlidSchema.brand<'CouponId'>();
export type CouponId = z.infer<typeof CouponIdSchema>;

export const CouponRedemptionIdSchema = UlidSchema.brand<'CouponRedemptionId'>();
export type CouponRedemptionId = z.infer<typeof CouponRedemptionIdSchema>;

export const ReviewIdSchema = UlidSchema.brand<'ReviewId'>();
export type ReviewId = z.infer<typeof ReviewIdSchema>;

export const OutboxEventIdSchema = UlidSchema.brand<'OutboxEventId'>();
export type OutboxEventId = z.infer<typeof OutboxEventIdSchema>;

/** `Idempotency-Key` header value (Golden Rule #3) — a client-generated ULID. */
export const IdempotencyKeySchema = UlidSchema.brand<'IdempotencyKey'>();
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
