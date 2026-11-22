import { z } from 'zod';
import { LocaleSchema, ProductStatusSchema } from '../enums';
import {
  CategoryIdSchema,
  ProductIdSchema,
  ProductImageIdSchema,
  ProductVariantIdSchema,
  VendorIdSchema,
} from '../ids';
import { HttpUrlSchema, PageQuerySchema, PageSchema, SlugSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
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

/** Query of `GET /v1/vendor/products`: cursor page, optionally one status. */
export const VendorProductQuerySchema = PageQuerySchema.extend({
  status: ProductStatusSchema.optional(),
});
export type VendorProductQuery = z.infer<typeof VendorProductQuerySchema>;

/** Vendor-side variant: unlike the public shape it exposes the raw stock counters. */
export const VendorProductVariantSchema = z.object({
  id: ProductVariantIdSchema,
  productId: ProductIdSchema,
  sku: z.string().min(1),
  attributes: VariantAttributesSchema,
  price: NonNegativeMoneySchema,
  stockOnHand: z.number().int().nonnegative(),
  stockReserved: z.number().int().nonnegative(),
});
export type VendorProductVariant = z.infer<typeof VendorProductVariantSchema>;

export const VendorProductTranslationSchema = z.object({
  locale: LocaleSchema,
  name: z.string().min(1),
  slug: SlugSchema,
  description: z.string().nullable(),
});
export type VendorProductTranslation = z.infer<typeof VendorProductTranslationSchema>;

export const VendorProductImageSchema = z.object({
  id: ProductImageIdSchema,
  url: HttpUrlSchema,
  alt: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type VendorProductImage = z.infer<typeof VendorProductImageSchema>;

/** Vendor-side product read: raw translations (vi + en), `status` (incl. BLOCKED) and `blockedReason`. */
export const VendorProductSchema = z.object({
  id: ProductIdSchema,
  vendorId: VendorIdSchema,
  status: ProductStatusSchema,
  blockedReason: z.string().nullable(),
  translations: z.array(VendorProductTranslationSchema),
  basePrice: NonNegativeMoneySchema,
  primaryImageUrl: HttpUrlSchema.nullable(),
  images: z.array(VendorProductImageSchema),
  categoryIds: z.array(CategoryIdSchema),
  variants: z.array(VendorProductVariantSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type VendorProduct = z.infer<typeof VendorProductSchema>;

/** Row of the vendor's product list; `name` is the Vietnamese name (the required locale). */
export const VendorProductSummarySchema = z.object({
  id: ProductIdSchema,
  status: ProductStatusSchema,
  blockedReason: z.string().nullable(),
  name: z.string(),
  basePrice: NonNegativeMoneySchema,
  primaryImageUrl: HttpUrlSchema.nullable(),
  variantCount: z.number().int().nonnegative(),
  stockOnHand: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
});
export type VendorProductSummary = z.infer<typeof VendorProductSummarySchema>;

export const VendorProductPageSchema = PageSchema(VendorProductSummarySchema);
export type VendorProductPage = z.infer<typeof VendorProductPageSchema>;

/** Body of `PATCH /v1/vendor/variants/:id/stock` — absolute on-hand count (never below reserved). */
export const VariantStockUpdateSchema = z.object({
  stockOnHand: z.number().int().nonnegative(),
});
export type VariantStockUpdate = z.infer<typeof VariantStockUpdateSchema>;
