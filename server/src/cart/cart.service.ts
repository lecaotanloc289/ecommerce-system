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

    const variant = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
      ...VARIANT_ARGS,
    });
    if (!variant) throw new DomainError('product.error.variant-not-found', { variantId });
    if (!isSellable(variant)) throw new DomainError('product.error.not-available', { variantId });
    const available = stockAvailable(variant);
    if (quantity > available) {
      throw new DomainError('cart.error.quantity-exceeds-stock', {
        variantId,
        requested: quantity,
        available,
      });
    }

    const cartId = await this.ensureCart(this.prisma.client, userId);
    await this.prisma.client.cartItem.upsert({
      where: { cartId_variantId: { cartId, variantId } },
      create: { id: ulid(), cartId, variantId, quantity },
      update: { quantity },
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

  /** Race-safe lazy creation: upsert on the unique `userId` (INSERT … ON CONFLICT), never find-then-create. */
  private async ensureCart(
    db: Pick<Prisma.TransactionClient, 'cart'>,
    userId: string,
  ): Promise<string> {
    const cart = await db.cart.upsert({
      where: { userId },
      create: { id: ulid(), userId },
      update: {},
      select: { id: true },
    });
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
    if (!translation) continue; // a product without any translation cannot be shown

    const unavailable = !(product.status === 'ACTIVE' && product.vendor.status === 'ACTIVE');
    const unitPrice = toMoney(variant.priceAmount, variant.priceCurrency);
    const line: CartLine = {
      variantId: variant.id as CartLine['variantId'],
      productId: product.id as CartLine['productId'],
      vendorId: product.vendorId as CartLine['vendorId'],
      productName: translation.name,
      productSlug: translation.slug,
      attributes: VariantAttributesSchema.parse(variant.attributes),
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
