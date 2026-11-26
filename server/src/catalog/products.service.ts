import { Injectable } from '@nestjs/common';
import { toMoney } from '@repo/db';
import {
  DomainError,
  ProductDetailSchema,
  ProductSummaryPageSchema,
  VariantAttributesSchema,
  type CatalogLocale,
  type ProductDetail,
  type ProductListQuery,
  type ProductSummaryPage,
  type SearchQuery,
} from '@repo/core';
import { computeRatingSummary, round2 } from '../common/rating-summary';
import { PrismaService } from '../prisma/prisma.service';
import { pickTranslation } from './locale';
import { ProductsRepository } from './products.repository';
import { CategoriesService } from './categories.service';

const VISIBLE = { status: 'ACTIVE', vendor: { status: 'ACTIVE' } } as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductsRepository,
    private readonly categories: CategoriesService,
  ) {}

  /** `GET /v1/products` (also the vendor page's product list). */
  async list(
    query: Omit<ProductListQuery, 'vendorSlug'> & { vendorSlug?: string | undefined },
  ): Promise<ProductSummaryPage> {
    let categoryIds: string[] | null = null;
    if (query.categorySlug !== undefined) {
      categoryIds = await this.categories.descendantIds(query.categorySlug);
      if (categoryIds === null) return { items: [], nextCursor: null };
    }
    // Prices of different currencies are not comparable: price filters/sorts fall back to the platform default currency.
    const needsCurrency =
      query.minPrice !== undefined ||
      query.maxPrice !== undefined ||
      query.sort === 'price_asc' ||
      query.sort === 'price_desc';
    const currency =
      query.currency ??
      (needsCurrency
        ? (
            await this.prisma.client.platformSettings.findFirst({
              select: { defaultCurrency: true },
            })
          )?.defaultCurrency
        : undefined);
    const ids = await this.repo.listVisibleIds({
      categoryIds,
      vendorSlug: query.vendorSlug ?? null,
      currency: currency ?? null,
      minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null,
      sort: query.sort,
      cursor: query.cursor ?? null,
      take: query.limit + 1,
    });
    return this.page(ids, query.limit, query.locale);
  }

  /** `GET /v1/search`. */
  async search(query: SearchQuery): Promise<ProductSummaryPage> {
    const ids = await this.repo.searchVisibleIds(query.q, query.cursor ?? null, query.limit + 1);
    return this.page(ids, query.limit, query.locale);
  }

  /** `GET /v1/products/:slug` — slug of any translation; rendered in `locale`. */
  async detail(slug: string, locale: CatalogLocale): Promise<ProductDetail> {
    const hit = await this.prisma.client.productTranslation.findFirst({
      where: { slug, product: VISIBLE },
      select: { productId: true },
    });
    const product = hit
      ? await this.prisma.client.product.findFirst({
          where: { id: hit.productId, ...VISIBLE },
          include: {
            translations: true,
            vendor: true,
            images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
            variants: { orderBy: { id: 'asc' } },
            categories: { select: { categoryId: true } },
          },
        })
      : null;
    const tr = product ? pickTranslation(product.translations, locale) : undefined;
    if (!product || !tr) throw new DomainError('product.error.not-found', { slug });

    const rating = await computeRatingSummary(this.prisma, product.id);
    return ProductDetailSchema.parse({
      id: product.id,
      vendorId: product.vendorId,
      status: product.status,
      name: tr.name,
      slug: tr.slug,
      description: tr.description,
      basePrice: toMoney(product.basePriceAmount, product.basePriceCurrency),
      primaryImageUrl: product.primaryImageUrl,
      images: product.images.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      categoryIds: product.categories.map((c) => c.categoryId),
      variants: product.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        sku: v.sku,
        attributes: VariantAttributesSchema.parse(v.attributes),
        price: toMoney(v.priceAmount, v.priceCurrency),
        // stockOnHand / stockReserved are internal; only the difference is exposed.
        stockAvailable: Math.max(0, v.stockOnHand - v.stockReserved),
      })),
      vendor: {
        id: product.vendor.id,
        slug: product.vendor.slug,
        displayName: product.vendor.displayName,
        logoUrl: product.vendor.logoUrl,
        description: product.vendor.description,
      },
      rating,
    });
  }

  /** Trims the look-ahead id, hydrates cards (in id order) and computes `nextCursor`. */
  private async page(
    ids: readonly string[],
    limit: number,
    locale: CatalogLocale,
  ): Promise<ProductSummaryPage> {
    const pageIds = ids.slice(0, limit);
    const nextCursor = ids.length > limit ? (pageIds.at(-1) ?? null) : null;
    if (pageIds.length === 0) return { items: [], nextCursor: null };

    const [products, ratings] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { id: { in: [...pageIds] }, ...VISIBLE },
        include: { translations: true },
      }),
      this.prisma.client.review.groupBy({
        by: ['productId'],
        where: { productId: { in: [...pageIds] } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const ratingById = new Map(ratings.map((r) => [r.productId, r]));

    const items = pageIds.flatMap((id) => {
      const product = byId.get(id);
      const tr = product ? pickTranslation(product.translations, locale) : undefined;
      if (!product || !tr) return [];
      const r = ratingById.get(id);
      return [
        {
          id: product.id,
          vendorId: product.vendorId,
          name: tr.name,
          slug: tr.slug,
          basePrice: toMoney(product.basePriceAmount, product.basePriceCurrency),
          primaryImageUrl: product.primaryImageUrl,
          rating: {
            average: r?._avg.rating ? round2(r._avg.rating) : null,
            count: r?._count._all ?? 0,
          },
        },
      ];
    });
    return ProductSummaryPageSchema.parse({ items, nextCursor });
  }
}
