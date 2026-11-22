import { Module } from '@nestjs/common';
import {
  CategoriesController,
  PlatformSettingsPublicController,
  ProductsController,
  VendorsPublicController,
} from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import { PlatformSettingsPublicService, VendorsPublicService } from './vendors-settings.service';

/** Public (unauthenticated) read API over categories, products, search, vendors, settings. */
@Module({
  controllers: [
    CategoriesController,
    ProductsController,
    VendorsPublicController,
    PlatformSettingsPublicController,
  ],
  providers: [
    CategoriesService,
    ProductsRepository,
    ProductsService,
    VendorsPublicService,
    PlatformSettingsPublicService,
  ],
})
export class CatalogModule {}
