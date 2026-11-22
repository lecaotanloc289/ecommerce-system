import { describe, expect, it } from 'vitest';
import { ProductDetailSchema, type ProductDetail } from '@repo/core';
import {
  attributesLabel,
  computeTotals,
  defaultVariant,
  toCartSnapshot,
  variantLabel,
  type CartItemSnapshot,
} from '../src/lib/cart';
import {
  EMPTY_CART,
  addBlocker,
  addItem,
  applyRefresh,
  cartViews,
  removeItem,
  sanitizeCart,
  setItemQuantity,
} from '../src/lib/guest-cart';

const ulid = (n: number) => `01JD${String(n).padStart(22, '0')}`;

function product(
  overrides: {
    variants?: { id: number; price: number; stock: number; size?: string }[];
    currency?: 'VND' | 'USD';
    slug?: string;
    name?: string;
  } = {},
): ProductDetail {
  const currency = overrides.currency ?? 'VND';
  const variants = overrides.variants ?? [{ id: 11, price: 199_000, stock: 5, size: 'M' }];
  return ProductDetailSchema.parse({
    id: ulid(1),
    vendorId: ulid(2),
    status: 'ACTIVE',
    name: overrides.name ?? 'Basic Tee',
    slug: overrides.slug ?? 'basic-tee',
    description: 'Cotton t-shirt',
    basePrice: { amount: 199_000, currency },
    primaryImageUrl: null,
    images: [],
    categoryIds: [],
    variants: variants.map((v) => ({
      id: ulid(v.id),
      productId: ulid(1),
      sku: `SKU-${v.id}`,
      attributes: v.size ? { size: v.size } : {},
      price: { amount: v.price, currency },
      stockAvailable: v.stock,
    })),
    vendor: {
      id: ulid(2),
      slug: 'vendor-a',
      displayName: 'Vendor A',
      logoUrl: null,
      description: null,
    },
    rating: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] },
  });
}

function snapshot(p: ProductDetail, index = 0): CartItemSnapshot {
  const variant = p.variants[index];
  if (!variant) throw new Error('no variant');
  return toCartSnapshot(p, variant);
}

describe('variant helpers', () => {
  it('labels variants by attribute values, falling back to the SKU', () => {
    expect(variantLabel({ attributes: { size: 'M', color: 'black' }, sku: 'X' })).toBe('M / black');
    expect(variantLabel({ attributes: {}, sku: 'MUG-WHT-350' })).toBe('MUG-WHT-350');
    expect(attributesLabel({})).toBe('');
  });

  it('preselects the first in-stock variant', () => {
    const p = product({
      variants: [
        { id: 11, price: 1, stock: 0 },
        { id: 12, price: 2, stock: 3 },
      ],
    });
    expect(defaultVariant(p)?.id).toBe(ulid(12));
    const soldOut = product({ variants: [{ id: 11, price: 1, stock: 0 }] });
    expect(defaultVariant(soldOut)?.id).toBe(ulid(11));
  });

  it('snapshots the selected variant price, not the base price', () => {
    const p = product({ variants: [{ id: 11, price: 250_000, stock: 2, size: 'L' }] });
    expect(snapshot(p)).toMatchObject({
      variantId: ulid(11),
      productName: 'Basic Tee',
      unitPrice: { amount: 250_000, currency: 'VND' },
      vendorName: 'Vendor A',
      vendorSlug: 'vendor-a',
      stockAvailable: 2,
    });
  });
});

describe('guest cart', () => {
  it('stores lines as { variantId, quantity } and sums repeated adds, clamped to stock', () => {
    const item = snapshot(product({ variants: [{ id: 11, price: 100, stock: 3 }] }));
    let cart = addItem(EMPTY_CART, item, 2);
    cart = addItem(cart, item, 2);
    expect(cart.lines).toEqual([{ variantId: ulid(11), quantity: 3 }]);
    expect(cartViews(cart)[0]).toMatchObject({ quantity: 3, maxQty: 3 });
  });

  it('refuses sold-out variants and a second currency (one order = one currency)', () => {
    const soldOut = snapshot(product({ variants: [{ id: 11, price: 100, stock: 0 }] }));
    expect(addBlocker(EMPTY_CART, soldOut)).toBe('out-of-stock');
    const vnd = addItem(EMPTY_CART, snapshot(product()), 1);
    const usd = snapshot(
      product({ currency: 'USD', variants: [{ id: 21, price: 999, stock: 4 }] }),
    );
    expect(addBlocker(vnd, usd)).toBe('currency-mismatch');
    expect(addItem(vnd, usd, 1)).toBe(vnd);
  });

  it('setItemQuantity keeps 1..stock; removeItem drops the line and its snapshot', () => {
    const cart = addItem(EMPTY_CART, snapshot(product()), 1);
    expect(setItemQuantity(cart, ulid(11), 0).lines[0]?.quantity).toBe(1);
    expect(setItemQuantity(cart, ulid(11), 50).lines[0]?.quantity).toBe(5);
    expect(setItemQuantity(cart, ulid(99), 2)).toBe(cart);
    expect(removeItem(cart, ulid(11))).toEqual(EMPTY_CART);
  });

  it('sanitizes untrusted storage: bad lines, missing snapshots, duplicates, legacy format', () => {
    const item = snapshot(product());
    const stored = {
      lines: [
        { variantId: ulid(11), quantity: 2 },
        { variantId: ulid(11), quantity: 2 },
        { variantId: 'p1-body', quantity: 1 },
        { variantId: ulid(12), quantity: 1 },
        { variantId: ulid(11), quantity: 1.5 },
      ],
      items: [item, { variantId: ulid(13), productName: '' }],
    };
    expect(sanitizeCart(stored).lines).toEqual([{ variantId: ulid(11), quantity: 4 }]);
    expect(sanitizeCart([{ productId: 'p1', qty: 1 }])).toEqual(EMPTY_CART);
    expect(sanitizeCart('garbage')).toEqual(EMPTY_CART);
  });

  it('refresh updates price/name/stock, drops vanished products, keeps failed lookups', () => {
    const tee = product();
    const mug = product({
      slug: 'white-ceramic-mug',
      name: 'Mug',
      variants: [{ id: 31, price: 89_000, stock: 9 }],
    });
    const candle = product({
      slug: 'nen-thom',
      name: 'Candle',
      variants: [{ id: 41, price: 50_000, stock: 9 }],
    });
    let cart = addItem(EMPTY_CART, snapshot(tee), 4);
    cart = addItem(cart, snapshot(mug), 1);
    cart = addItem(cart, snapshot(candle), 1);

    const teeNow = product({
      name: 'Áo thun',
      variants: [{ id: 11, price: 179_000, stock: 2, size: 'M' }],
    });
    const next = applyRefresh(cart, [
      { slug: 'basic-tee', ok: true, product: teeNow },
      { slug: 'white-ceramic-mug', ok: true, product: null },
      { slug: 'nen-thom', ok: false },
    ]);

    const views = cartViews(next);
    expect(views.map((v) => v.productName)).toEqual(['Áo thun', 'Candle']);
    expect(views[0]).toMatchObject({
      quantity: 2,
      unitPrice: { amount: 179_000, currency: 'VND' },
    });
  });

  it('does not crash a USD cart on the VND-only mock shipping fee and voucher', () => {
    const usd = snapshot(
      product({ currency: 'USD', variants: [{ id: 21, price: 1999, stock: 4 }] }),
    );
    const lines = cartViews(addItem(EMPTY_CART, usd, 2));
    const fedex = {
      id: 's',
      carrier: 'fedex' as const,
      name: 'FedEx',
      eta: { minDays: 1, maxDays: 2 },
      fee: { amount: 60_000, currency: 'VND' as const },
    };
    const voucher = {
      code: 'X',
      type: 'FIXED' as const,
      amount: { amount: 50_000, currency: 'VND' as const },
      minSubtotal: { amount: 0, currency: 'VND' as const },
    };
    const totals = computeTotals(lines, fedex, voucher, 'VND');
    expect(totals).toMatchObject({
      subtotal: { amount: 3998, currency: 'USD' },
      shipping: { amount: 0, currency: 'USD' },
      discount: { amount: 0, currency: 'USD' },
      total: { amount: 3998, currency: 'USD' },
    });
  });

  it('totals the resolved lines in integer minor units', () => {
    const cart = addItem(
      EMPTY_CART,
      snapshot(product({ variants: [{ id: 11, price: 199_000, stock: 9 }] })),
      3,
    );
    const totals = computeTotals(cartViews(cart), undefined, undefined, 'VND');
    expect(totals).toMatchObject({ itemCount: 3, subtotal: { amount: 597_000, currency: 'VND' } });
  });
});
