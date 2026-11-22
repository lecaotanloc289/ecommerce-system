import { z } from 'zod';
import { CurrencySchema } from '../enums';
import { ProductIdSchema, VendorIdSchema } from '../ids';
import { CategorySchema } from './category';
import { HttpUrlSchema, PageQuerySchema, PageSchema, SlugSchema } from './common';
import { NonNegativeMoneySchema } from './money';
import { ProductSchema } from './product';
import { RatingSummarySchema } from './review';
import { VendorPublicSchema } from './vendor';

/** Public catalog language (`?locale=vi|en`, default `vi`). Lowercase on the wire, unlike the DB enum. */
export const CatalogLocaleSchema = z.enum(['vi', 'en']);
export type CatalogLocale = z.infer<typeof CatalogLocaleSchema>;
export const DEFAULT_CATALOG_LOCALE: CatalogLocale = 'vi';

/** Query of endpoints that only need a language. */
export const LocaleQuerySchema = z.object({
  locale: CatalogLocaleSchema.default(DEFAULT_CATALOG_LOCALE),
});
export type LocaleQuery = z.infer<typeof LocaleQuerySchema>;

/** A category with its children (`GET /v1/categories`). Depth is unbounded. */
export interface CategoryNode extends z.infer<typeof CategorySchema> {
  children: CategoryNode[];
}
export const CategoryNodeSchema: z.ZodType<CategoryNode> = CategorySchema.extend({
  get children() {
    return z.array(CategoryNodeSchema);
  },
});

/** `GET /v1/categories` — the whole tree, roots first, siblings by `sortOrder`. */
export const CategoryTreeSchema = z.object({ items: z.array(CategoryNodeSchema) });
export type CategoryTree = z.infer<typeof CategoryTreeSchema>;

/** `GET /v1/categories/:slug` — the category, its path from the root, and direct children. */
export const CategoryDetailSchema = CategorySchema.extend({
  breadcrumb: z.array(CategorySchema),
  children: z.array(CategorySchema),
});
export type CategoryDetail = z.infer<typeof CategoryDetailSchema>;

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'rating'] as const;
export const ProductSortSchema = z.enum(PRODUCT_SORTS);
export type ProductSort = z.infer<typeof ProductSortSchema>;

/**
 * Query of `GET /v1/products`. Prices are minor units of `currency` (omit `currency` to ignore
 * the currency). For non-`newest` sorts the cursor is still the last item's id — the server
 * derives the sort key from it (keyset pagination).
 */
const ProductListQueryShape = PageQuerySchema.extend({
  locale: CatalogLocaleSchema.default(DEFAULT_CATALOG_LOCALE),
  categorySlug: SlugSchema.optional(),
  vendorSlug: SlugSchema.optional(),
  currency: CurrencySchema.optional(),
  minPrice: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  maxPrice: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  sort: ProductSortSchema.default('newest'),
});

const priceRangeValid = (q: { minPrice?: number | undefined; maxPrice?: number | undefined }) =>
  q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice;
const priceRangeIssue = { message: 'minPrice must not exceed maxPrice', path: ['minPrice'] };

export const ProductListQuerySchema = ProductListQueryShape.refine(
  priceRangeValid,
  priceRangeIssue,
);
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

/** Query of `GET /v1/search`. */
export const SearchQuerySchema = PageQuerySchema.extend({
  locale: CatalogLocaleSchema.default(DEFAULT_CATALOG_LOCALE),
  q: z.string().trim().min(1).max(100),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** Query of `GET /v1/vendors/:slug` (the vendor's products). */
export const VendorProductsQuerySchema = ProductListQueryShape.omit({
  vendorSlug: true,
}).refine(priceRangeValid, priceRangeIssue);
export type VendorProductsQuery = z.infer<typeof VendorProductsQuerySchema>;

/** Rating shown on a card; `average` is `null` until the first review. */
export const RatingBriefSchema = RatingSummarySchema.pick({ average: true, count: true });
export type RatingBrief = z.infer<typeof RatingBriefSchema>;

/** Product card in lists and search results. */
export const ProductSummarySchema = z.object({
  id: ProductIdSchema,
  vendorId: VendorIdSchema,
  name: z.string().min(1),
  slug: SlugSchema,
  basePrice: NonNegativeMoneySchema,
  primaryImageUrl: HttpUrlSchema.nullable(),
  rating: RatingBriefSchema,
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

export const ProductSummaryPageSchema = PageSchema(ProductSummarySchema);
export type ProductSummaryPage = z.infer<typeof ProductSummaryPageSchema>;

/** `GET /v1/products/:slug`. */
export const ProductDetailSchema = ProductSchema.extend({
  vendor: VendorPublicSchema,
  rating: RatingSummarySchema,
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

/** `GET /v1/vendors/:slug` — shop header plus one page of its products. */
export const VendorDetailSchema = VendorPublicSchema.extend({
  products: ProductSummaryPageSchema,
});
export type VendorDetail = z.infer<typeof VendorDetailSchema>;
