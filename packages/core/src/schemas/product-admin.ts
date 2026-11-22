import { z } from 'zod';
import { LocaleSchema, ProductStatusSchema } from '../enums';
import { CategoryIdSchema, ProductImageIdSchema, ProductVariantIdSchema } from '../ids';
import { SlugSchema } from './common';
import { NonNegativeMoneySchema } from './money';
import { VariantAttributesSchema } from './product';
import { UploadKeySchema } from './upload';

const MAX_VARIANTS = 100;
const MAX_IMAGES = 20;
const MAX_CATEGORIES = 10;

const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Statuses a vendor may set; `BLOCKED` is platform-only (moderation). */
export const VendorProductStatusSchema = ProductStatusSchema.exclude(['BLOCKED']);
export type VendorProductStatus = z.infer<typeof VendorProductStatusSchema>;

export const ProductTranslationInputSchema = z.object({
  locale: LocaleSchema,
  name: z.string().trim().min(1).max(200),
  slug: SlugSchema,
  description: z
    .string()
    .trim()
    .max(10_000)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});
export type ProductTranslationInput = z.infer<typeof ProductTranslationInputSchema>;

/** Variant in an upsert. `id` present → update that variant; absent → create. */
export const ProductVariantInputSchema = z.object({
  id: ProductVariantIdSchema.optional(),
  sku: z.string().trim().min(1).max(64),
  attributes: VariantAttributesSchema,
  price: NonNegativeMoneySchema,
  stockOnHand: z.number().int().nonnegative(),
});
export type ProductVariantInput = z.infer<typeof ProductVariantInputSchema>;

/** Existing image (keep) or newly uploaded one (`media` key from presign). Array order = display order. */
export const ProductImageInputSchema = z.union([
  z.object({ id: ProductImageIdSchema, alt: z.string().trim().max(200).nullable().default(null) }),
  z.object({ key: UploadKeySchema, alt: z.string().trim().max(200).nullable().default(null) }),
]);
export type ProductImageInput = z.infer<typeof ProductImageInputSchema>;

/**
 * Body of `POST /v1/vendor/products` and `PUT /v1/vendor/products/:id`. Both locales are required
 * (i18n from day one). `vendorId` comes from `req.user`; all prices share one currency (D6).
 */
export const ProductUpsertSchema = z
  .object({
    status: VendorProductStatusSchema.default('DRAFT'),
    translations: z.array(ProductTranslationInputSchema).length(2),
    basePrice: NonNegativeMoneySchema,
    variants: z.array(ProductVariantInputSchema).min(1).max(MAX_VARIANTS),
    images: z.array(ProductImageInputSchema).max(MAX_IMAGES).default([]),
    categoryIds: z.array(CategoryIdSchema).min(1).max(MAX_CATEGORIES),
  })
  .refine((p) => isUnique(p.translations.map((t) => t.locale)), {
    message: 'Provide exactly one translation per locale (VI and EN)',
    path: ['translations'],
  })
  .refine((p) => isUnique(p.variants.map((v) => v.sku)), {
    message: 'Duplicate sku',
    path: ['variants'],
  })
  .refine((p) => isUnique(p.categoryIds), {
    message: 'Duplicate categoryId',
    path: ['categoryIds'],
  })
  .refine((p) => p.variants.every((v) => v.price.currency === p.basePrice.currency), {
    message: 'All variant prices must use the base price currency',
    path: ['variants'],
  });
export type ProductUpsert = z.infer<typeof ProductUpsertSchema>;
