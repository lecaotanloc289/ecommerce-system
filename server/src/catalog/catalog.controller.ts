import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { SlugSchema } from '@repo/core';
import { CategoriesService } from './categories.service';
import {
  CategoryDetailDto,
  CategoryTreeDto,
  LocaleQueryDto,
  PlatformSettingsPublicDto,
  ProductDetailDto,
  ProductListQueryDto,
  ProductSummaryPageDto,
  SearchQueryDto,
  VendorDetailDto,
  VendorProductsQueryDto,
} from './catalog.dto';
import { ProductsService } from './products.service';
import { PlatformSettingsPublicService, VendorsPublicService } from './vendors-settings.service';

/** A malformed slug can never exist, so it is a plain 404-by-lookup rather than a 422. */
const slugOrEmpty = (raw: string): string => (SlugSchema.safeParse(raw).success ? raw : '');

@ApiTags('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @ApiOperation({ summary: 'Category tree (public)' })
  @ZodResponse({ status: 200, type: CategoryTreeDto })
  @Get()
  tree(@Query() query: LocaleQueryDto) {
    return this.categories.tree(query.locale);
  }

  @ApiOperation({ summary: 'Category by slug with breadcrumb and children (public)' })
  @ZodResponse({ status: 200, type: CategoryDetailDto })
  @Get(':slug')
  detail(@Param('slug') slug: string, @Query() query: LocaleQueryDto) {
    return this.categories.detail(slugOrEmpty(slug), query.locale);
  }
}

@ApiTags('catalog')
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @ApiOperation({ summary: 'List visible products with filters, sort and cursor pagination' })
  @ZodResponse({ status: 200, type: ProductSummaryPageDto })
  @Get('products')
  list(@Query() query: ProductListQueryDto) {
    return this.products.list(query);
  }

  @ApiOperation({ summary: 'Product detail by slug (variants, images, vendor, rating summary)' })
  @ZodResponse({ status: 200, type: ProductDetailDto })
  @Get('products/:slug')
  detail(@Param('slug') slug: string, @Query() query: LocaleQueryDto) {
    return this.products.detail(slugOrEmpty(slug), query.locale);
  }

  @ApiOperation({ summary: 'Full-text + trigram product search' })
  @ZodResponse({ status: 200, type: ProductSummaryPageDto })
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.products.search(query);
  }
}

@ApiTags('catalog')
@Controller()
export class VendorsPublicController {
  constructor(private readonly vendors: VendorsPublicService) {}

  @ApiOperation({ summary: 'Public shop page: vendor header + its products' })
  @ZodResponse({ status: 200, type: VendorDetailDto })
  @Get('vendors/:slug')
  detail(@Param('slug') slug: string, @Query() query: VendorProductsQueryDto) {
    return this.vendors.detail(slugOrEmpty(slug), query);
  }
}

@ApiTags('catalog')
@Controller('platform-settings')
export class PlatformSettingsPublicController {
  constructor(private readonly settings: PlatformSettingsPublicService) {}

  @ApiOperation({ summary: 'Currencies and limits the storefront needs (public)' })
  @ZodResponse({ status: 200, type: PlatformSettingsPublicDto })
  @Get('public')
  get() {
    return this.settings.get();
  }
}
