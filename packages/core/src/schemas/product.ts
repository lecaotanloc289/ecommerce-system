import { z } from 'zod';
import { ProductStatusSchema } from '../enums';
import {
  CategoryIdSchema,
  ProductIdSchema,
  ProductImageIdSchema,
  ProductVariantIdSchema,
  VendorIdSchema,
} from '../ids';
import { HttpUrlSchema, SlugSchema } from './common';
import { NonNegativeMoneySchema } from './money';

/** JSONB variant attributes, e.g. `{ size: 'M', color: 'black' }`. */
export const VariantAttributesSchema = z.record(z.string().min(1), z.string());
export type VariantAttributes = z.infer<typeof VariantAttributesSchema>;

/**
 * Variant read shape. `stockAvailable` = stockOnHand − stockReserved, computed by the
 * API; raw reservation counters are internal and never exposed.
 */
export const ProductVariantSchema = z.object({
  id: ProductVariantIdSchema,
  productId: ProductIdSchema,
  sku: z.string().min(1),
  attributes: VariantAttributesSchema,
  price: NonNegativeMoneySchema,
  stockAvailable: z.number().int().nonnegative(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

export const ProductImageSchema = z.object({
  id: ProductImageIdSchema,
  url: HttpUrlSchema,
  alt: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type ProductImage = z.infer<typeof ProductImageSchema>;

/** Product read shape, resolved to the requested locale (name/slug/description). */
export const ProductSchema = z.object({
  id: ProductIdSchema,
  vendorId: VendorIdSchema,
  status: ProductStatusSchema,
  name: z.string().min(1),
  slug: SlugSchema,
  description: z.string().nullable(),
  basePrice: NonNegativeMoneySchema,
  primaryImageUrl: HttpUrlSchema.nullable(),
  images: z.array(ProductImageSchema),
  categoryIds: z.array(CategoryIdSchema),
  variants: z.array(ProductVariantSchema),
});
export type Product = z.infer<typeof ProductSchema>;
