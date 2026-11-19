import { describe, expect, it } from 'vitest';
import {
  AddressInputSchema,
  AddressSchema,
  CartLineInputSchema,
  CartLineSchema,
  CategorySchema,
  CategoryTranslationSchema,
  CheckoutSchema,
  CouponCodeSchema,
  HttpUrlSchema,
  MAX_CART_LINE_QUANTITY,
  MoneySchema,
  NonNegativeMoneySchema,
  ProductImageSchema,
  ProductSchema,
  ProductVariantSchema,
  SlugSchema,
} from '../src/schemas';
import { ulid } from './fixtures';

const vnd = (amount: number) => ({ amount, currency: 'VND' });

describe('MoneySchema', () => {
  it('accepts signed integers in a supported currency', () => {
    expect(MoneySchema.parse({ amount: -500, currency: 'USD' })).toEqual({
      amount: -500,
      currency: 'USD',
    });
  });

  it.each([
    ['float amount', { amount: 1.5, currency: 'VND' }],
    ['unsafe integer', { amount: Number.MAX_SAFE_INTEGER + 2, currency: 'VND' }],
    ['string amount', { amount: '100', currency: 'VND' }],
    ['unknown currency', { amount: 100, currency: 'EUR' }],
  ])('rejects %s', (_label, value) => {
    expect(MoneySchema.safeParse(value).success).toBe(false);
  });

  it('NonNegativeMoneySchema rejects negatives but allows zero', () => {
    expect(NonNegativeMoneySchema.safeParse(vnd(0)).success).toBe(true);
    expect(NonNegativeMoneySchema.safeParse(vnd(-1)).success).toBe(false);
  });
});

describe('common', () => {
  it('SlugSchema', () => {
    expect(SlugSchema.safeParse('ao-thun-nam-2024').success).toBe(true);
    for (const bad of ['', 'Áo-thun', 'double--hyphen', '-leading', 'trailing-', 'has space']) {
      expect(SlugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('HttpUrlSchema allows only http(s)', () => {
    expect(HttpUrlSchema.safeParse('https://cdn.example.com/a.jpg').success).toBe(true);
    expect(HttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(HttpUrlSchema.safeParse('/relative.jpg').success).toBe(false);
  });
});

describe('Address', () => {
  const input = {
    recipientName: '  Nguyễn Văn A ',
    phone: '+84 912 345 678',
    line1: '12 Lê Lợi',
    ward: 'Bến Nghé',
    district: 'Quận 1',
    city: 'TP. Hồ Chí Minh',
  };

  it('AddressInputSchema trims and applies defaults', () => {
    const parsed = AddressInputSchema.parse(input);
    expect(parsed.recipientName).toBe('Nguyễn Văn A');
    expect(parsed.country).toBe('VN');
    expect(parsed.isDefault).toBe(false);
    expect(parsed.line2).toBeUndefined();
    expect(AddressInputSchema.parse({ ...input, line2: '   ' }).line2).toBeUndefined();
    expect(AddressInputSchema.parse({ ...input, line2: ' Tầng 3 ' }).line2).toBe('Tầng 3');
  });

  it.each([
    ['blank name', { ...input, recipientName: '   ' }],
    ['bad phone', { ...input, phone: 'call me' }],
    ['too few digits', { ...input, phone: '1234567' }],
    ['lowercase country', { ...input, country: 'vn' }],
    ['missing city', { ...input, city: undefined }],
  ])('AddressInputSchema rejects %s', (_label, value) => {
    expect(AddressInputSchema.safeParse(value).success).toBe(false);
  });

  it('AddressSchema mirrors the DB row (nullable line2)', () => {
    const row = { ...input, id: ulid(1), line2: null, country: 'VN', isDefault: true };
    expect(AddressSchema.parse(row).line2).toBeNull();
    expect(AddressSchema.safeParse({ ...row, id: 'addr_1' }).success).toBe(false);
  });
});

describe('Category', () => {
  it('CategoryTranslationSchema', () => {
    expect(
      CategoryTranslationSchema.safeParse({ locale: 'VI', name: 'Thời trang', slug: 'thoi-trang' })
        .success,
    ).toBe(true);
    expect(
      CategoryTranslationSchema.safeParse({ locale: 'vi', name: 'Thời trang', slug: 'thoi-trang' })
        .success,
    ).toBe(false);
  });

  it('CategorySchema', () => {
    const category = {
      id: ulid(2),
      parentId: null,
      sortOrder: 0,
      name: 'Apparel',
      slug: 'apparel',
    };
    expect(CategorySchema.parse(category)).toEqual(category);
    expect(CategorySchema.safeParse({ ...category, parentId: undefined }).success).toBe(false);
  });
});

describe('Product', () => {
  const variant = {
    id: ulid(10),
    productId: ulid(11),
    sku: 'TS-M-BLK',
    attributes: { size: 'M', color: 'black' },
    price: vnd(199_000),
    stockAvailable: 12,
  };
  const image = { id: ulid(12), url: 'https://cdn.example.com/p.jpg', alt: null, sortOrder: 0 };
  const product = {
    id: ulid(11),
    vendorId: ulid(13),
    status: 'ACTIVE',
    name: 'Áo thun',
    slug: 'ao-thun',
    description: null,
    basePrice: vnd(199_000),
    primaryImageUrl: null,
    images: [image],
    categoryIds: [ulid(2)],
    variants: [variant],
  };

  it('ProductVariantSchema', () => {
    expect(ProductVariantSchema.parse(variant)).toEqual(variant);
    expect(ProductVariantSchema.safeParse({ ...variant, stockAvailable: -1 }).success).toBe(false);
    expect(ProductVariantSchema.safeParse({ ...variant, attributes: { size: 1 } }).success).toBe(
      false,
    );
  });

  it('ProductImageSchema', () => {
    expect(ProductImageSchema.safeParse(image).success).toBe(true);
    expect(ProductImageSchema.safeParse({ ...image, url: 'ftp://x/y.jpg' }).success).toBe(false);
  });

  it('ProductSchema', () => {
    expect(ProductSchema.parse(product)).toEqual(product);
    expect(ProductSchema.safeParse({ ...product, status: 'PUBLISHED' }).success).toBe(false);
    expect(ProductSchema.safeParse({ ...product, basePrice: vnd(199_000.5) }).success).toBe(false);
  });
});

describe('Cart', () => {
  it('CartLineInputSchema bounds quantity to positive integers', () => {
    expect(CartLineInputSchema.safeParse({ variantId: ulid(10), quantity: 1 }).success).toBe(true);
    for (const quantity of [0, -1, 1.5, MAX_CART_LINE_QUANTITY + 1]) {
      expect(CartLineInputSchema.safeParse({ variantId: ulid(10), quantity }).success).toBe(false);
    }
  });

  it('CartLineSchema', () => {
    const line = {
      variantId: ulid(10),
      productId: ulid(11),
      vendorId: ulid(13),
      productName: 'Áo thun',
      productSlug: 'ao-thun',
      attributes: { size: 'M' },
      imageUrl: null,
      unitPrice: vnd(199_000),
      quantity: 2,
      stockAvailable: 12,
    };
    expect(CartLineSchema.parse(line)).toEqual(line);
    expect(CartLineSchema.safeParse({ ...line, unitPrice: vnd(-1) }).success).toBe(false);
  });
});

describe('Checkout', () => {
  const request = {
    items: [
      { variantId: ulid(10), quantity: 2 },
      { variantId: ulid(20), quantity: 1 },
    ],
    addressId: ulid(1),
    shippingMethodIds: [ulid(30), ulid(31)],
    provider: 'VNPAY',
  };

  it('accepts a multi-vendor request and defaults couponCodes to []', () => {
    const parsed = CheckoutSchema.parse(request);
    expect(parsed.couponCodes).toEqual([]);
    expect(parsed.items).toHaveLength(2);
  });

  it('trims coupon codes', () => {
    expect(CheckoutSchema.parse({ ...request, couponCodes: [' SALE10 '] }).couponCodes).toEqual([
      'SALE10',
    ]);
  });

  it.each([
    ['empty items', { ...request, items: [] }],
    ['duplicate variant', { ...request, items: [request.items[0], request.items[0]] }],
    ['no shipping method', { ...request, shippingMethodIds: [] }],
    ['duplicate shipping method', { ...request, shippingMethodIds: [ulid(30), ulid(30)] }],
    ['duplicate coupon', { ...request, couponCodes: ['A1', 'A1'] }],
    ['coupon with spaces', { ...request, couponCodes: ['SALE 10'] }],
    ['lowercase provider', { ...request, provider: 'vnpay' }],
    ['unsupported provider', { ...request, provider: 'WALLET' }],
    ['non-ULID address', { ...request, addressId: 'addr_1' }],
  ])('rejects %s', (_label, value) => {
    expect(CheckoutSchema.safeParse(value).success).toBe(false);
  });

  it('CouponCodeSchema', () => {
    expect(CouponCodeSchema.safeParse('WELCOME-2026').success).toBe(true);
    expect(CouponCodeSchema.safeParse('   ').success).toBe(false);
  });
});
