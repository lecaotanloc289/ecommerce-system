import { describe, expect, it } from 'vitest';
import {
  VariantStockUpdateSchema,
  VendorProductQuerySchema,
  VendorProductSummarySchema,
} from '../src';

describe('vendor catalog schemas', () => {
  it('accepts an optional status filter on the product list query', () => {
    expect(VendorProductQuerySchema.parse({ status: 'ACTIVE', limit: '5' })).toMatchObject({
      status: 'ACTIVE',
      limit: 5,
    });
    expect(VendorProductQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });

  it('requires a non-negative integer absolute stock', () => {
    expect(VariantStockUpdateSchema.parse({ stockOnHand: 0 }).stockOnHand).toBe(0);
    expect(VariantStockUpdateSchema.safeParse({ stockOnHand: -1 }).success).toBe(false);
    expect(VariantStockUpdateSchema.safeParse({ stockOnHand: 1.5 }).success).toBe(false);
  });

  it('rejects a summary with a negative stock count', () => {
    const row = {
      id: '01J00000000000000000000000',
      status: 'DRAFT',
      blockedReason: null,
      name: 'x',
      basePrice: { amount: 1, currency: 'VND' },
      primaryImageUrl: null,
      variantCount: 1,
      stockOnHand: -1,
      updatedAt: '2026-11-23T00:00:00.000Z',
    };
    expect(VendorProductSummarySchema.safeParse(row).success).toBe(false);
    expect(VendorProductSummarySchema.safeParse({ ...row, stockOnHand: 0 }).success).toBe(true);
  });
});
