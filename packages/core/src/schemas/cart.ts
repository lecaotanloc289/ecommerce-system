import { z } from 'zod';
import { ProductIdSchema, ProductVariantIdSchema, VendorIdSchema } from '../ids';
import { HttpUrlSchema, SlugSchema } from './common';
import { NonNegativeMoneySchema } from './money';
import { VariantAttributesSchema } from './product';

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

/** Cart line as returned by the API — current price and stock, resolved to the caller's locale. */
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
  stockAvailable: z.number().int().nonnegative(),
});
export type CartLine = z.infer<typeof CartLineSchema>;
