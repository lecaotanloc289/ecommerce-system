import { z } from 'zod';
import { CurrencySchema } from '../enums';
import { ProductIdSchema, ProductVariantIdSchema, VendorIdSchema } from '../ids';
import { HttpUrlSchema, SlugSchema } from './common';
import { NonNegativeMoneySchema } from './money';
import { VariantAttributesSchema } from './product';
import { ShippingMethodSchema } from './shipping-method';

/** Per-line quantity ceiling — a payload sanity bound, not a stock rule (stock is checked server-side). */
export const MAX_CART_LINE_QUANTITY = 999;

/**
 * What a client sends for one cart line (add-to-cart, guest cart in localStorage,
 * checkout items). Only the variant and quantity — price, vendor and title are
 * always re-read from the DB (never trust client-supplied price / vendorId).
 */
export const CartLineInputSchema = z.object({
  variantId: ProductVariantIdSchema,
  quantity: z.number().int().min(1).max(MAX_CART_LINE_QUANTITY),
});
export type CartLineInput = z.infer<typeof CartLineInputSchema>;

/** Cart line as returned by the API — current price and stock, resolved to the caller's locale.
 * `unavailable` = the product is no longer ACTIVE or its vendor is no longer ACTIVE: show it greyed
 * out, exclude it from totals, and let the customer remove it (checkout rejects it).
 * `quantity` may exceed `stockAvailable` if stock dropped after the line was added. */
export const CartLineSchema = z.object({
  variantId: ProductVariantIdSchema,
  productId: ProductIdSchema,
  vendorId: VendorIdSchema,
  productName: z.string().min(1),
  productSlug: SlugSchema,
  attributes: VariantAttributesSchema,
  imageUrl: HttpUrlSchema.nullable(),
  unitPrice: NonNegativeMoneySchema,
  quantity: z.number().int().min(1).max(MAX_CART_LINE_QUANTITY),
  lineTotal: NonNegativeMoneySchema,
  stockAvailable: z.number().int().nonnegative(),
  unavailable: z.boolean(),
});
export type CartLine = z.infer<typeof CartLineSchema>;

/** Max distinct lines in one cart — a DB/payload sanity bound (`cart.error.too-many-lines`). */
export const MAX_CART_LINES = 100;
const MAX_MERGE_LINES = MAX_CART_LINES;

/** Query of the cart read endpoints: the locale product names/slugs are resolved to. */
export const CartQuerySchema = z.object({
  locale: z.enum(['vi', 'en']).default('vi'),
});
export type CartQuery = z.infer<typeof CartQuerySchema>;

/** Body of `PUT /v1/cart/items/:variantId`. `quantity: 0` removes the line. */
export const CartItemSetSchema = z.object({
  quantity: z.number().int().min(0).max(MAX_CART_LINE_QUANTITY),
});
export type CartItemSet = z.infer<typeof CartItemSetSchema>;

/**
 * Body of `POST /v1/cart/merge`: the guest cart. Duplicate variants are allowed and summed.
 * Call it ONCE after sign-in and then clear the guest cart — each call with a new
 * `Idempotency-Key` adds the quantities again; only a retry with the same key replays.
 */
export const CartMergeInputSchema = z.object({
  items: z.array(CartLineInputSchema).min(1).max(MAX_MERGE_LINES),
});
export type CartMergeInput = z.infer<typeof CartMergeInputSchema>;

/** One vendor's lines. A cart may mix currencies, so subtotals are per currency (available lines only). */
export const CartVendorGroupSchema = z.object({
  vendorId: VendorIdSchema,
  vendorSlug: SlugSchema,
  vendorName: z.string().min(1),
  lines: z.array(CartLineSchema),
  subtotals: z.array(NonNegativeMoneySchema),
});
export type CartVendorGroup = z.infer<typeof CartVendorGroupSchema>;

/** The caller's cart, lines grouped by vendor (oldest line first). Prices are current, never stored. */
export const CartSchema = z.object({
  groups: z.array(CartVendorGroupSchema),
  /** Sum of quantities of available lines. */
  itemCount: z.number().int().nonnegative(),
  /** Available lines span more than one currency — checkout will reject it (`checkout.error.currency-mismatch`). */
  hasMixedCurrency: z.boolean(),
  currencies: z.array(CurrencySchema),
});
export type Cart = z.infer<typeof CartSchema>;

export const CartMergeAdjustmentReasonSchema = z.enum(['UNAVAILABLE', 'CLAMPED']);
export type CartMergeAdjustmentReason = z.infer<typeof CartMergeAdjustmentReasonSchema>;

/**
 * A merge line that did not land as sent. `UNAVAILABLE` = unknown or unsellable variant, dropped
 * (`appliedQuantity` 0). `CLAMPED` = existing + incoming quantity was cut to the available stock.
 */
export const CartMergeAdjustmentSchema = z.object({
  variantId: ProductVariantIdSchema,
  reason: CartMergeAdjustmentReasonSchema,
  /** `CLAMPED`: existing + incoming quantity wanted; `UNAVAILABLE`: the incoming quantity. */
  requestedQuantity: z.number().int().positive(),
  appliedQuantity: z.number().int().nonnegative(),
});
export type CartMergeAdjustment = z.infer<typeof CartMergeAdjustmentSchema>;

export const CartMergeResultSchema = z.object({
  cart: CartSchema,
  adjustments: z.array(CartMergeAdjustmentSchema),
});
export type CartMergeResult = z.infer<typeof CartMergeResultSchema>;

/** `GET /v1/cart/shipping-options`: active shipping methods of every vendor in the cart. */
export const CartShippingOptionsSchema = z.object({
  groups: z.array(
    z.object({
      vendorId: VendorIdSchema,
      methods: z.array(ShippingMethodSchema),
    }),
  ),
});
export type CartShippingOptions = z.infer<typeof CartShippingOptionsSchema>;
