import { Injectable } from '@nestjs/common';
import {
  type Currency,
  DomainError,
  type ProductUpsert,
  type VendorProduct,
  type VendorProductPage,
  VendorProductPageSchema,
  type VendorProductQuery,
  VendorProductSchema,
  type VendorProductVariant,
  VariantAttributesSchema,
  VendorProductVariantSchema,
} from '@repo/core';
import { type Prisma, toDbAmount, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  assertCurrencySupported,
  assertVendorActive,
  assertWalletCurrency,
  isUniqueViolation,
  supportedCurrencies,
} from './vendor-scope';

const DETAIL_INCLUDE = {
  translations: true,
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  variants: { orderBy: { id: 'asc' } },
  categories: { select: { categoryId: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type VariantRow = ProductRow['variants'][number];

const LOCALES = ['VI', 'EN'] as const;

const notFound = (id: string): DomainError => new DomainError('product.error.not-found', { id });
const invalid = (field: string): DomainError =>
  new DomainError('common.error.validation-failed', { field });

function toVariant(v: VariantRow): VendorProductVariant {
  return VendorProductVariantSchema.parse({
    id: v.id,
    productId: v.productId,
    sku: v.sku,
    attributes: VariantAttributesSchema.parse(v.attributes),
    price: toMoney(v.priceAmount, v.priceCurrency),
    stockOnHand: v.stockOnHand,
    stockReserved: v.stockReserved,
  });
}

function toVendorProduct(p: ProductRow): VendorProduct {
  return VendorProductSchema.parse({
    id: p.id,
    vendorId: p.vendorId,
    status: p.status,
    blockedReason: p.blockedReason,
    translations: p.translations.map((t) => ({
      locale: t.locale,
      name: t.name,
      slug: t.slug,
      description: t.description,
    })),
    basePrice: toMoney(p.basePriceAmount, p.basePriceCurrency),
    primaryImageUrl: p.primaryImageUrl,
    images: p.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, sortOrder: i.sortOrder })),
    categoryIds: p.categories.map((c) => c.categoryId),
    variants: p.variants.map(toVariant),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  });
}

/**
 * Vendor catalog writes. Every method takes the `vendorId` from `req.user` (never the client),
 * scopes every query by it (another vendor's rows are 404) and, for writes, re-checks
 * `Vendor.status = ACTIVE` inside the transaction.
 */
@Injectable()
export class VendorProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(vendorId: string, query: VendorProductQuery): Promise<VendorProductPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.product.findMany({
      ...args,
      where: { vendorId, ...(query.status && { status: query.status }), ...args.where },
      include: {
        translations: { where: { locale: 'VI' } },
        variants: { select: { stockOnHand: true } },
      },
    });
    const page = toPage(rows, query);
    return VendorProductPageSchema.parse({
      items: page.items.map((p) => ({
        id: p.id,
        status: p.status,
        blockedReason: p.blockedReason,
        name: p.translations[0]?.name ?? '',
        basePrice: toMoney(p.basePriceAmount, p.basePriceCurrency),
        primaryImageUrl: p.primaryImageUrl,
        variantCount: p.variants.length,
        stockOnHand: p.variants.reduce((sum, v) => sum + v.stockOnHand, 0),
        updatedAt: p.updatedAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    });
  }

  async get(vendorId: string, id: string): Promise<VendorProduct> {
    const row = await this.prisma.client.product.findFirst({
      where: { id, vendorId },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw notFound(id);
    return toVendorProduct(row);
  }

  /** `POST /v1/vendor/products` — always creates a DRAFT; publishing is a separate call. */
  async create(vendorId: string, body: ProductUpsert): Promise<VendorProduct> {
    if (body.variants.some((v) => v.id) || body.images.some((i) => 'id' in i)) {
      throw invalid('id');
    }
    const id = await this.write(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const productId = ulid();
      await tx.product.create({
        data: {
          id: productId,
          vendorId,
          status: 'DRAFT',
          basePriceAmount: 0n,
          basePriceCurrency: body.basePrice.currency,
        },
      });
      await this.apply(tx, vendorId, productId, body, new Map());
      return productId;
    });
    return this.get(vendorId, id);
  }

  /**
   * `PUT /v1/vendor/products/:id` — full replace of translations, variants, images, categories.
   * `body.status` is ignored: status only changes through publish / archive.
   */
  async update(vendorId: string, id: string, body: ProductUpsert): Promise<VendorProduct> {
    await this.write(async (tx) => {
      await assertVendorActive(tx, vendorId);
      // Locks the row (serialises concurrent edits) and reads the status after the lock.
      const product = await this.lockOwned(tx, vendorId, id);
      if (product.status === 'BLOCKED') throw new DomainError('product.error.blocked', { id });
      const existing = await tx.productVariant.findMany({ where: { productId: id } });
      await this.apply(
        tx,
        vendorId,
        id,
        body,
        new Map(existing.map((v) => [v.id, v])),
        product.status,
      );
    });
    return this.get(vendorId, id);
  }

  async publish(vendorId: string, id: string): Promise<VendorProduct> {
    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const product = await this.lockOwned(tx, vendorId, id);
      if (product.status === 'BLOCKED') {
        throw new DomainError('product.error.blocked', { id });
      }
      if (product.status === 'ACTIVE') return;
      await this.assertPublishable(tx, id);
      await tx.product.update({ where: { id }, data: { status: 'ACTIVE' } });
    });
    return this.get(vendorId, id);
  }

  async archive(vendorId: string, id: string): Promise<VendorProduct> {
    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const product = await this.lockOwned(tx, vendorId, id);
      if (product.status === 'BLOCKED') {
        throw new DomainError('product.error.blocked', { id });
      }
      if (product.status !== 'ARCHIVED') {
        await tx.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
      }
    });
    return this.get(vendorId, id);
  }

  /**
   * `PATCH /v1/vendor/variants/:id/stock` — sets the absolute on-hand count. One conditional
   * UPDATE (`stock_reserved <= :new`) so a concurrent checkout reservation can never be undercut.
   */
  async setStock(
    vendorId: string,
    variantId: string,
    stockOnHand: number,
  ): Promise<VendorProductVariant> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, product: { vendorId } },
        select: { id: true },
      });
      if (!variant) throw new DomainError('product.error.variant-not-found', { id: variantId });
      const { count } = await tx.productVariant.updateMany({
        where: { id: variantId, stockReserved: { lte: stockOnHand } },
        data: { stockOnHand },
      });
      const fresh = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      if (count === 0) {
        throw new DomainError('product.error.stock-below-reserved', {
          variantId,
          stockReserved: fresh.stockReserved,
        });
      }
      return toVariant(fresh);
    });
  }

  private async lockOwned(tx: Prisma.TransactionClient, vendorId: string, id: string) {
    const product = await tx.product.findFirst({
      where: { id, vendorId },
      select: { id: true, status: true },
    });
    if (!product) throw notFound(id);
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
    // Re-read after the lock: a moderation block may have landed while waiting.
    const locked = await tx.product.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true },
    });
    return locked;
  }

  /** Publishable = a Vietnamese name and at least one variant, every variant priced above zero. */
  private async assertPublishable(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const [vi, variants, free] = await Promise.all([
      tx.productTranslation.count({ where: { productId: id, locale: 'VI', name: { not: '' } } }),
      tx.productVariant.count({ where: { productId: id } }),
      tx.productVariant.count({ where: { productId: id, priceAmount: { lte: 0 } } }),
    ]);
    if (vi === 0 || variants === 0 || free > 0) {
      throw new DomainError('product.error.not-publishable', { id });
    }
  }

  /** Runs `fn` in a transaction; a lost unique-constraint race becomes 409 `common.error.conflict`. */
  private async write<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.client.$transaction(fn, { timeout: 15_000 });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('common.error.conflict');
      throw error;
    }
  }

  /** Writes the upsert body onto an existing (or just created) product row. */
  private async apply(
    tx: Prisma.TransactionClient,
    vendorId: string,
    productId: string,
    body: ProductUpsert,
    existingVariants: ReadonlyMap<string, VariantRow>,
    currentStatus: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'BLOCKED' = 'DRAFT',
  ): Promise<void> {
    const currency: Currency = body.basePrice.currency;
    assertCurrencySupported(await supportedCurrencies(tx), currency, 'basePrice');
    await assertWalletCurrency(tx, vendorId, currency);

    // Translations: both locales, slug unique per locale.
    const viName = body.translations.find((t) => t.locale === 'VI');
    if (!viName) throw invalid('translations');
    for (const t of body.translations) {
      const clash = await tx.productTranslation.findFirst({
        where: { locale: t.locale, slug: t.slug, productId: { not: productId } },
        select: { id: true },
      });
      if (clash)
        throw new DomainError('common.error.conflict', { field: 'slug', locale: t.locale });
    }

    // Categories must exist.
    const categories = await tx.category.count({ where: { id: { in: body.categoryIds } } });
    if (categories !== body.categoryIds.length) throw invalid('categoryIds');

    // Variants: resolve ids (explicit id, else same-product sku), then check sku clashes.
    const bySku = new Map([...existingVariants.values()].map((v) => [v.sku, v]));
    const resolved = body.variants.map((input) => {
      if (input.id !== undefined && !existingVariants.has(input.id)) {
        throw new DomainError('product.error.variant-not-found', { id: input.id });
      }
      const target = input.id !== undefined ? existingVariants.get(input.id) : bySku.get(input.sku);
      return { input, target };
    });
    const targets = resolved.flatMap((r) => (r.target ? [r.target.id] : []));
    const keptIds = new Set(targets);
    if (keptIds.size !== targets.length) throw invalid('variants');
    const skuRows = await tx.productVariant.findMany({
      where: { sku: { in: resolved.map((r) => r.input.sku) } },
      select: { id: true, sku: true },
    });
    for (const row of skuRows) {
      // A sku held by a variant of this product that stays is fine; anything else is taken.
      if (!keptIds.has(row.id)) {
        throw new DomainError('common.error.conflict', { field: 'sku', sku: row.sku });
      }
    }

    // Removed variants: only if never ordered or carted.
    for (const variant of existingVariants.values()) {
      if (keptIds.has(variant.id)) continue;
      const [ordered, carted] = await Promise.all([
        tx.orderItem.count({ where: { variantId: variant.id } }),
        tx.cartItem.count({ where: { variantId: variant.id } }),
      ]);
      if (ordered + carted > 0) {
        throw new DomainError('product.error.variant-in-use', { sku: variant.sku });
      }
      await tx.productVariant.delete({ where: { id: variant.id } });
    }

    for (const { input, target } of resolved) {
      const data = {
        sku: input.sku,
        attributes: input.attributes,
        priceAmount: toDbAmount(input.price),
        priceCurrency: currency,
        stockOnHand: input.stockOnHand,
      };
      if (!target) {
        await tx.productVariant.create({ data: { id: ulid(), productId, ...data } });
        continue;
      }
      // Conditional on reserved stock so a concurrent checkout reservation is never undercut.
      const { count } = await tx.productVariant.updateMany({
        where: { id: target.id, stockReserved: { lte: input.stockOnHand } },
        data,
      });
      if (count === 0) {
        const fresh = await tx.productVariant.findUniqueOrThrow({ where: { id: target.id } });
        throw new DomainError('product.error.stock-below-reserved', {
          sku: input.sku,
          stockReserved: fresh.stockReserved,
        });
      }
    }

    // Translations upsert.
    for (const locale of LOCALES) {
      const t = body.translations.find((x) => x.locale === locale);
      if (!t) throw invalid('translations');
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId, locale } },
        create: {
          id: ulid(),
          productId,
          locale,
          name: t.name,
          slug: t.slug,
          description: t.description ?? null,
        },
        update: { name: t.name, slug: t.slug, description: t.description ?? null },
      });
    }

    // Categories.
    await tx.productCategory.deleteMany({ where: { productId } });
    await tx.productCategory.createMany({
      data: body.categoryIds.map((categoryId) => ({ productId, categoryId })),
    });

    // Images: array order = display order; keys must be this vendor's uploads.
    const ownImages = await tx.productImage.findMany({ where: { productId } });
    const ownById = new Map(ownImages.map((i) => [i.id, i]));
    const keptImages = new Set<string>();
    const ordered: { url: string }[] = [];
    for (const [sortOrder, image] of body.images.entries()) {
      const alt = image.alt;
      if ('id' in image) {
        const own = ownById.get(image.id);
        if (!own) throw new DomainError('common.error.not-found', { field: 'images' });
        keptImages.add(own.id);
        await tx.productImage.update({ where: { id: own.id }, data: { alt, sortOrder } });
        ordered.push({ url: own.url });
      } else {
        const key = this.storage.assertOwnedKey(image.key, { type: 'vendor', vendorId });
        const url = this.storage.publicUrl(key);
        await tx.productImage.create({ data: { id: ulid(), productId, url, alt, sortOrder } });
        ordered.push({ url });
      }
    }
    await tx.productImage.deleteMany({
      where: {
        productId,
        id: { in: ownImages.filter((i) => !keptImages.has(i.id)).map((i) => i.id) },
      },
    });

    // Product row. `basePrice` mirrors MIN(variant price): the public catalog filters/sorts on it
    // while cart/checkout charge the variant price.
    const basePrice = Math.min(...body.variants.map((v) => v.price.amount));
    await tx.product.update({
      where: { id: productId },
      data: {
        basePriceAmount: toDbAmount({ amount: basePrice, currency }),
        basePriceCurrency: currency,
        primaryImageUrl: ordered[0]?.url ?? null,
      },
    });
    if (currentStatus === 'ACTIVE') await this.assertPublishable(tx, productId);
  }
}
