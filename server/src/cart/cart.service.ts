import { Injectable } from '@nestjs/common';
import {
  type Cart,
  type CartLine,
  type CartLineInput,
  type CartMergeAdjustment,
  type CartMergeResult,
  type CartQuery,
  type CartShippingOptions,
  type Currency,
  DomainError,
  MAX_CART_LINE_QUANTITY,
  MAX_CART_LINES,
  Money,
  VariantAttributesSchema,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';

type CartLocale = CartQuery['locale'];

const ITEM_ARGS = {
  orderBy: { id: 'asc' },
  include: {
    variant: {
      include: {
        product: {
          include: {
            translations: true,
            images: { orderBy: { sortOrder: 'asc' }, take: 1 },
            vendor: { select: { id: true, slug: true, displayName: true, status: true } },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemFindManyArgs;

type CartItemRow = Prisma.CartItemGetPayload<typeof ITEM_ARGS>;

const VARIANT_ARGS = {
  include: { product: { select: { status: true, vendor: { select: { status: true } } } } },
} satisfies Prisma.ProductVariantDefaultArgs;

type VariantRow = Prisma.ProductVariantGetPayload<typeof VARIANT_ARGS>;

const isSellable = (variant: VariantRow): boolean =>
  variant.product.status === 'ACTIVE' && variant.product.vendor.status === 'ACTIVE';

const stockAvailable = (variant: VariantRow): number =>
  Math.max(0, variant.stockOnHand - variant.stockReserved);

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read-only: a user without a cart sees an empty one (the Cart row is created lazily on first write). */
  async getCart(userId: string, locale: CartLocale): Promise<Cart> {
    return this.readCart(userId, locale);
  }

  async setItem(
    userId: string,
    variantId: string,
    quantity: number,
    locale: CartLocale,
  ): Promise<Cart> {
    if (quantity === 0) return this.removeItem(userId, variantId, locale);

    await this.prisma.client.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        ...VARIANT_ARGS,
      });
      if (!variant) throw new DomainError('product.error.variant-not-found', { variantId });
      if (!isSellable(variant)) throw new DomainError('product.error.not-available', { variantId });
      const available = stockAvailable(variant);
      const cartId = await this.ensureCart(tx, userId);
      // Same cart-row lock as `merge`: concurrent writers serialise, so the line cap is exact.
      await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE`;
      const line = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
        select: { quantity: true },
      });
      // Lowering a line is always allowed (stock may have dropped under it); only raising is checked.
      if (quantity > (line?.quantity ?? 0) && quantity > available) {
        throw new DomainError('cart.error.quantity-exceeds-stock', {
          variantId,
          requested: quantity,
          available,
        });
      }

      if (!line) await this.assertRoomForNewLine(tx, cartId, 1);
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId } },
        create: { id: ulid(), cartId, variantId, quantity },
        update: { quantity },
      });
    });
    return this.readCart(userId, locale);
  }

  async removeItem(userId: string, variantId: string, locale: CartLocale): Promise<Cart> {
    await this.prisma.client.cartItem.deleteMany({ where: { variantId, cart: { userId } } });
    return this.readCart(userId, locale);
  }

  /**
   * Guest-cart merge. Quantities add to existing lines and are clamped to the available stock (and
   * the per-line ceiling); a merge never lowers an existing line. Unknown / unsellable variants are
   * dropped. Not naturally idempotent: callers rely on `@Idempotent()` for retries.
   */
  async merge(
    userId: string,
    items: readonly CartLineInput[],
    locale: CartLocale,
  ): Promise<CartMergeResult> {
    const incoming = new Map<string, number>();
    for (const { variantId, quantity } of items) {
      incoming.set(variantId, (incoming.get(variantId) ?? 0) + quantity);
    }

    const adjustments = await this.prisma.client.$transaction(async (tx) => {
      const cartId = await this.ensureCart(tx, userId);
      // Serialise concurrent merges on the same cart so the read-modify-write below is exact.
      await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE`;

      const [existing, variants] = await Promise.all([
        tx.cartItem.findMany({ where: { cartId } }),
        tx.productVariant.findMany({
          where: { id: { in: [...incoming.keys()] } },
          ...VARIANT_ARGS,
        }),
      ]);
      const existingQty = new Map(existing.map((i) => [i.variantId, i.quantity]));
      const variantById = new Map(variants.map((v) => [v.id, v]));

      const result: CartMergeAdjustment[] = [];
      for (const [variantId, add] of incoming) {
        const variant = variantById.get(variantId);
        if (!variant || !isSellable(variant)) {
          result.push({
            variantId: variantId as CartMergeAdjustment['variantId'],
            reason: 'UNAVAILABLE',
            requestedQuantity: add,
            appliedQuantity: 0,
          });
          continue;
        }
        const current = existingQty.get(variantId) ?? 0;
        const total = current + add;
        const cap = Math.min(MAX_CART_LINE_QUANTITY, stockAvailable(variant));
        const applied = Math.max(current, Math.min(total, cap));
        if (applied < total) {
          result.push({
            variantId: variant.id as CartMergeAdjustment['variantId'],
            reason: 'CLAMPED',
            requestedQuantity: total,
            appliedQuantity: applied,
          });
        }
        if (applied === current) continue;
        if (current === 0) await this.assertRoomForNewLine(tx, cartId, 1);
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId, variantId } },
          create: { id: ulid(), cartId, variantId, quantity: applied },
          update: { quantity: applied },
        });
      }
      return result;
    });

    return { cart: await this.readCart(userId, locale), adjustments };
  }

  async getShippingOptions(userId: string): Promise<CartShippingOptions> {
    const items = await this.prisma.client.cartItem.findMany({
      where: {
        cart: { userId },
        variant: { product: { status: 'ACTIVE', vendor: { status: 'ACTIVE' } } },
      },
      orderBy: { id: 'asc' },
      select: { variant: { select: { product: { select: { vendorId: true } } } } },
    });
    const vendorIds = [...new Set(items.map((i) => i.variant.product.vendorId))];
    const methods = await this.prisma.client.shippingMethod.findMany({
      where: { vendorId: { in: vendorIds }, isActive: true },
      orderBy: { id: 'asc' },
    });
    return {
      groups: vendorIds.map((vendorId) => ({
        vendorId: vendorId as CartShippingOptions['groups'][number]['vendorId'],
        methods: methods
          .filter((m) => m.vendorId === vendorId)
          .map((m) => ({
            id: m.id as CartShippingOptions['groups'][number]['methods'][number]['id'],
            vendorId: m.vendorId as CartShippingOptions['groups'][number]['vendorId'],
            name: m.name,
            price: toMoney(m.priceAmount, m.priceCurrency),
            estDays: m.estDays,
            isActive: m.isActive,
          })),
      })),
    };
  }

  private async assertRoomForNewLine(
    db: Pick<Prisma.TransactionClient, 'cartItem'>,
    cartId: string,
    adding: number,
  ): Promise<void> {
    const count = await db.cartItem.count({ where: { cartId } });
    if (count + adding > MAX_CART_LINES) {
      throw new DomainError('cart.error.too-many-lines', { max: MAX_CART_LINES });
    }
  }

  /** Race-safe lazy creation: upsert on the unique `userId` (INSERT … ON CONFLICT), never find-then-create. */
  private async ensureCart(
    db: Pick<Prisma.TransactionClient, 'cart'>,
    userId: string,
  ): Promise<string> {
    // INSERT … ON CONFLICT DO NOTHING (Prisma's upsert can still raise P2002 under a race, which
    // would also abort a surrounding transaction), then read the winner's row.
    await db.cart.createMany({ data: [{ id: ulid(), userId }], skipDuplicates: true });
    const cart = await db.cart.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    return cart.id;
  }

  private async readCart(userId: string, locale: CartLocale): Promise<Cart> {
    const items = await this.prisma.client.cartItem.findMany({
      where: { cart: { userId } },
      ...ITEM_ARGS,
    });
    return buildCart(items, locale);
  }
}

function buildCart(items: readonly CartItemRow[], locale: CartLocale): Cart {
  const wanted = locale === 'vi' ? 'VI' : 'EN';
  const groups = new Map<string, Cart['groups'][number]>();
  const currencies = new Set<Currency>();
  let itemCount = 0;

  for (const item of items) {
    const { variant } = item;
    const { product } = variant;
    const translation =
      product.translations.find((t) => t.locale === wanted) ?? product.translations[0];

    const unavailable = !(product.status === 'ACTIVE' && product.vendor.status === 'ACTIVE');
    const unitPrice = toMoney(variant.priceAmount, variant.priceCurrency);
    const line: CartLine = {
      variantId: variant.id as CartLine['variantId'],
      productId: product.id as CartLine['productId'],
      vendorId: product.vendorId as CartLine['vendorId'],
      // No translation: show the variant SKU so the line stays visible and removable.
      productName: translation?.name ?? variant.sku,
      productSlug: translation?.slug ?? skuSlug(variant.sku),
      attributes: parseAttributes(variant.attributes),
      imageUrl: product.primaryImageUrl ?? product.images[0]?.url ?? null,
      unitPrice,
      quantity: item.quantity,
      lineTotal: Money.multiply(unitPrice, item.quantity),
      stockAvailable: stockAvailable(variant),
      unavailable,
    };

    let group = groups.get(product.vendorId);
    if (!group) {
      group = {
        vendorId: product.vendorId as CartLine['vendorId'],
        vendorSlug: product.vendor.slug,
        vendorName: product.vendor.displayName,
        lines: [],
        subtotals: [],
      };
      groups.set(product.vendorId, group);
    }
    group.lines.push(line);

    if (unavailable) continue;
    itemCount += line.quantity;
    currencies.add(unitPrice.currency);
    const idx = group.subtotals.findIndex((s) => s.currency === unitPrice.currency);
    const existing = group.subtotals[idx];
    if (existing) group.subtotals[idx] = Money.add(existing, line.lineTotal);
    else group.subtotals.push(line.lineTotal);
  }

  return {
    groups: [...groups.values()],
    itemCount,
    hasMixedCurrency: currencies.size > 1,
    currencies: [...currencies],
  };
}

/** A malformed JSONB row must not take the whole cart down: fall back to no attributes. */
function parseAttributes(value: unknown): CartLine['attributes'] {
  const parsed = VariantAttributesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** A `Slug`-shaped form of a SKU (lowercase, dash-separated) for lines whose product has no translation. */
function skuSlug(sku: string): string {
  return (
    sku
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'product'
  );
}
