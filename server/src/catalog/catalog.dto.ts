import { createZodDto } from 'nestjs-zod';
import {
  CategoryDetailSchema,
  CategoryTreeSchema,
  LocaleQuerySchema,
  PlatformSettingsPublicSchema,
  ProductDetailSchema,
  ProductListQuerySchema,
  ProductSummaryPageSchema,
  SearchQuerySchema,
  VendorDetailSchema,
  VendorProductsQuerySchema,
} from '@repo/core';

/** DTOs for the public catalog controllers (schemas live in `@repo/core/schemas/catalog`). */
export class LocaleQueryDto extends createZodDto(LocaleQuerySchema) {}
export class ProductListQueryDto extends createZodDto(ProductListQuerySchema) {}
export class SearchQueryDto extends createZodDto(SearchQuerySchema) {}
export class VendorProductsQueryDto extends createZodDto(VendorProductsQuerySchema) {}
export class CategoryTreeDto extends createZodDto(CategoryTreeSchema) {}
export class CategoryDetailDto extends createZodDto(CategoryDetailSchema) {}
export class ProductSummaryPageDto extends createZodDto(ProductSummaryPageSchema) {}
export class ProductDetailDto extends createZodDto(ProductDetailSchema) {}
export class VendorDetailDto extends createZodDto(VendorDetailSchema) {}
export class PlatformSettingsPublicDto extends createZodDto(PlatformSettingsPublicSchema) {}
