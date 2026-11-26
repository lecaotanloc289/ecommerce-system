import { Injectable } from '@nestjs/common';
import {
  DomainError,
  PlatformSettingsPublicSchema,
  VendorDetailSchema,
  type PlatformSettingsPublic,
  type VendorDetail,
  type VendorProductsQuery,
} from '@repo/core';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

@Injectable()
export class VendorsPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  /** `GET /v1/vendors/:slug` — only ACTIVE vendors are public; others 404. */
  async detail(slug: string, query: VendorProductsQuery): Promise<VendorDetail> {
    const vendor = await this.prisma.client.vendor.findFirst({ where: { slug, status: 'ACTIVE' } });
    if (!vendor) throw new DomainError('vendor.error.not-found', { slug });
    const products = await this.products.list({ ...query, vendorSlug: vendor.slug });
    return VendorDetailSchema.parse({
      id: vendor.id,
      slug: vendor.slug,
      displayName: vendor.displayName,
      logoUrl: vendor.logoUrl,
      description: vendor.description,
      products,
    });
  }
}

@Injectable()
export class PlatformSettingsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /v1/platform-settings/public` — the singleton row; a missing row is a deployment error. */
  async get(): Promise<PlatformSettingsPublic> {
    const row = await this.prisma.client.platformSettings.findFirst();
    if (!row)
      throw new DomainError('common.error.internal', { reason: 'platform-settings-missing' });
    return PlatformSettingsPublicSchema.parse({
      supportedCurrencies: row.supportedCurrencies,
      defaultCurrency: row.defaultCurrency,
      maxCouponStack: row.maxCouponStack,
    });
  }
}
