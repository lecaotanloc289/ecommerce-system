import { Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type PlatformProduct,
  type PlatformProductListQuery,
  type PlatformProductPage,
  PlatformProductPageSchema,
  PlatformProductSchema,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const LIST_INCLUDE = {
  include: {
    vendor: { select: { displayName: true } },
    translations: { where: { locale: 'VI' } },
  },
} satisfies Prisma.ProductDefaultArgs;
type ProductRow = Prisma.ProductGetPayload<typeof LIST_INCLUDE>;

function toPlatformProduct(row: ProductRow): PlatformProduct {
  return PlatformProductSchema.parse({
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendor.displayName,
    status: row.status,
    blockedReason: row.blockedReason,
    name: row.translations[0]?.name ?? '',
    basePrice: toMoney(row.basePriceAmount, row.basePriceCurrency),
    primaryImageUrl: row.primaryImageUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Product moderation. BLOCKED products are invisible everywhere (catalog and cart/checkout
 * require ACTIVE) and the vendor cannot publish, archive or edit them (`product.error.blocked`).
 */
@Injectable()
export class PlatformProductsService {
  private readonly logger = new Logger(PlatformProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformProductListQuery): Promise<PlatformProductPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.product.findMany({
      ...args,
      where: {
        ...(query.status && { status: query.status }),
        ...(query.vendorId && { vendorId: query.vendorId }),
        ...(query.q && {
          OR: [
            { id: query.q.toUpperCase() },
            { translations: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
            { translations: { some: { slug: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }),
        ...args.where,
      },
      ...LIST_INCLUDE,
    });
    const page = toPage(rows, query);
    return PlatformProductPageSchema.parse({
      items: page.items.map(toPlatformProduct),
      nextCursor: page.nextCursor,
    });
  }

  /** Any non-BLOCKED status → BLOCKED with the reason (already BLOCKED → 409). */
  async block(actorId: string, id: string, reason: string): Promise<PlatformProduct> {
    const row = await this.lockedUpdate(id, (status) => status !== 'BLOCKED', {
      status: 'BLOCKED',
      blockedReason: reason,
    });
    this.logger.log({ actorId, productId: id }, 'product blocked');
    return toPlatformProduct(row);
  }

  /** BLOCKED → DRAFT (the vendor must publish again), clearing the reason (else 409). */
  async unblock(actorId: string, id: string): Promise<PlatformProduct> {
    const row = await this.lockedUpdate(id, (status) => status === 'BLOCKED', {
      status: 'DRAFT',
      blockedReason: null,
    });
    this.logger.log({ actorId, productId: id }, 'product unblocked');
    return toPlatformProduct(row);
  }

  private lockedUpdate(
    id: string,
    allowed: (status: string) => boolean,
    data: Prisma.ProductUpdateInput,
  ): Promise<ProductRow> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM products WHERE id = ${id} FOR UPDATE`;
      const status = rows[0]?.status;
      if (status === undefined) throw new DomainError('product.error.not-found', { id });
      if (!allowed(status)) throw new DomainError('common.error.conflict', { id, status });
      return tx.product.update({ where: { id }, data, ...LIST_INCLUDE });
    });
  }
}
