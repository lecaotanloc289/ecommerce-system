import { describe, expect, it } from 'vitest';
import {
  CartItemSetSchema,
  CartMergeAdjustmentSchema,
  CartMergeInputSchema,
  CartMergeResultSchema,
  CartQuerySchema,
  CartSchema,
  CartShippingOptionsSchema,
  MAX_CART_LINE_QUANTITY,
} from '../src/schemas';
import { ulid } from './fixtures';

const vnd = (amount: number) => ({ amount, currency: 'VND' });

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
  lineTotal: vnd(398_000),
  stockAvailable: 12,
  unavailable: false,
};

const cart = {
  groups: [
    {
      vendorId: ulid(13),
      vendorSlug: 'shop-a',
      vendorName: 'Shop A',
      lines: [line],
      subtotals: [vnd(398_000)],
    },
  ],
  itemCount: 2,
  hasMixedCurrency: false,
  currencies: ['VND'],
};

describe('CartQuerySchema', () => {
  it('defaults to vi and rejects unknown locales', () => {
    expect(CartQuerySchema.parse({}).locale).toBe('vi');
    expect(CartQuerySchema.parse({ locale: 'en' }).locale).toBe('en');
    expect(CartQuerySchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});

describe('CartItemSetSchema', () => {
  it('allows 0 (remove) up to the line ceiling', () => {
    expect(CartItemSetSchema.safeParse({ quantity: 0 }).success).toBe(true);
    expect(CartItemSetSchema.safeParse({ quantity: MAX_CART_LINE_QUANTITY }).success).toBe(true);
  });
  it('rejects negative, fractional and oversized quantities', () => {
    for (const quantity of [-1, 1.5, MAX_CART_LINE_QUANTITY + 1]) {
      expect(CartItemSetSchema.safeParse({ quantity }).success).toBe(false);
    }
  });
});

describe('CartMergeInputSchema', () => {
  it('accepts lines (duplicates allowed) and rejects empty / oversized / bad lines', () => {
    const item = { variantId: ulid(10), quantity: 1 };
    expect(CartMergeInputSchema.safeParse({ items: [item, item] }).success).toBe(true);
    expect(CartMergeInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      CartMergeInputSchema.safeParse({ items: Array.from({ length: 101 }, () => item) }).success,
    ).toBe(false);
    expect(
      CartMergeInputSchema.safeParse({ items: [{ variantId: ulid(10), quantity: 0 }] }).success,
    ).toBe(false);
  });
});

describe('CartSchema', () => {
  it('parses a grouped cart and rejects a negative subtotal', () => {
    expect(CartSchema.parse(cart)).toEqual(cart);
    const bad = { ...cart, groups: [{ ...cart.groups[0], subtotals: [vnd(-1)] }] };
    expect(CartSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CartMergeResultSchema', () => {
  it('carries the cart and the adjustments', () => {
    const adjustment = {
      variantId: ulid(10),
      reason: 'CLAMPED',
      requestedQuantity: 5,
      appliedQuantity: 3,
    };
    expect(CartMergeResultSchema.parse({ cart, adjustments: [adjustment] }).adjustments).toEqual([
      adjustment,
    ]);
  });
  it('rejects an unknown reason', () => {
    const bad = { variantId: ulid(10), reason: 'NOPE', requestedQuantity: 1, appliedQuantity: 0 };
    expect(CartMergeAdjustmentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CartShippingOptionsSchema', () => {
  it('parses methods per vendor', () => {
    const method = {
      id: ulid(30),
      vendorId: ulid(13),
      name: 'Standard',
      price: vnd(30_000),
      estDays: 3,
      isActive: true,
    };
    const value = { groups: [{ vendorId: ulid(13), methods: [method] }] };
    expect(CartShippingOptionsSchema.parse(value)).toEqual(value);
    expect(
      CartShippingOptionsSchema.safeParse({
        groups: [{ vendorId: ulid(13), methods: [{ ...method, estDays: 0 }] }],
      }).success,
    ).toBe(false);
  });
});
