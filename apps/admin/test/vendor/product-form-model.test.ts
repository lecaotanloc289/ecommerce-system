import { describe, expect, it } from 'vitest';
import {
  emptyProductForm,
  emptyVariant,
  parseAttributes,
  parseStock,
  slugify,
  validateProduct,
  type ProductFormState,
} from '@/pages/vendor/product-form-model';

const id = (suffix: string) => `01JC${suffix.padStart(22, '0')}`;
const CATEGORY = id('C1');
const VARIANT_ID = id('V1');
const IMAGE_ID = id('M1');

function valid(): ProductFormState {
  return {
    ...emptyProductForm('VND'),
    nameVi: 'Áo thun',
    slugVi: 'ao-thun',
    nameEn: 'T-shirt',
    slugEn: 't-shirt',
    categoryIds: [CATEGORY],
    variants: [
      {
        ...emptyVariant(),
        sku: 'TS-1',
        attributes: 'Màu=Đỏ, Size=M',
        price: '150.000',
        stock: '5',
      },
    ],
  };
}

function errorsOf(state: ProductFormState) {
  const result = validateProduct(state);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

describe('validateProduct', () => {
  it('builds a ProductUpsert with exact minor units and the lowest price as base', () => {
    const state = valid();
    state.variants.push({ ...emptyVariant(), sku: 'TS-2', price: '99000', stock: '0' });
    const result = validateProduct(state);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.basePrice).toEqual({ amount: 99000, currency: 'VND' });
    expect(result.value.variants[0]).toMatchObject({
      sku: 'TS-1',
      attributes: { Màu: 'Đỏ', Size: 'M' },
      price: { amount: 150000, currency: 'VND' },
      stockOnHand: 5,
    });
    expect(result.value.translations.map((t) => t.locale)).toEqual(['VI', 'EN']);
  });

  it('parses USD prices to cents without float error', () => {
    const state = { ...valid(), currency: 'USD' as const };
    state.variants = [{ ...emptyVariant(), sku: 'A', price: '19.99', stock: '1' }];
    const result = validateProduct(state);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.variants[0]?.price.amount).toBe(1999);
  });

  it('requires both the Vietnamese and English name and slug', () => {
    const errors = errorsOf({ ...valid(), nameVi: ' ', nameEn: '', slugEn: '' });
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['nameVi', 'nameEn', 'slugEn']));
    expect(errors.slugVi).toBeUndefined();
  });

  it('rejects stock below the reserved quantity with the reserved count', () => {
    const state = valid();
    state.variants = [
      {
        ...emptyVariant(),
        id: VARIANT_ID,
        sku: 'TS-1',
        price: '1000',
        stock: '2',
        stockReserved: 3,
      },
    ];
    const error = errorsOf(state)['variants.0.stock'];
    expect(error?.key).toBe('admin.vendor.form.error.stockBelowReserved');
    expect(error?.params).toEqual({ reserved: 3 });
  });

  it('accepts stock equal to the reserved quantity and keeps the variant id', () => {
    const state = valid();
    state.variants = [
      {
        ...emptyVariant(),
        id: VARIANT_ID,
        sku: 'TS-1',
        price: '1000',
        stock: '3',
        stockReserved: 3,
      },
    ];
    const result = validateProduct(state);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.variants[0]?.id).toBe(VARIANT_ID);
  });

  it.each(['1.5', '-1', 'abc', '', '2147483648'])('rejects stock %j', (stock) => {
    const state = valid();
    state.variants = [{ ...emptyVariant(), sku: 'A', price: '1', stock }];
    expect(errorsOf(state)['variants.0.stock']).toBeDefined();
  });

  it('rejects an inexact price, a missing category and duplicate SKUs', () => {
    const state = valid();
    state.categoryIds = [];
    state.variants = [
      { ...emptyVariant(), sku: 'A', price: '1.5', stock: '1' },
      { ...emptyVariant(), sku: 'A', price: '10', stock: '1' },
    ];
    const errors = errorsOf(state);
    expect(errors['variants.0.price']).toBeDefined();
    expect(errors['variants.1.sku']?.key).toBe('admin.vendor.form.error.duplicateSku');
    expect(errors.categoryIds).toBeDefined();
  });

  it('sends existing images by id and new uploads by key only', () => {
    const state = valid();
    state.images = [
      { rowId: 'a', id: IMAGE_ID, url: 'http://x/1.png', alt: 'Front' },
      { rowId: 'b', key: 'media/vendors/v/new.png', url: 'blob:1', alt: '' },
    ];
    const result = validateProduct(state);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.images).toEqual([
      { id: IMAGE_ID, alt: 'Front' },
      { key: 'media/vendors/v/new.png', alt: null },
    ]);
  });
});

describe('helpers', () => {
  it('slugifies Vietnamese names', () => {
    expect(slugify('Áo thun Đẹp 2026!')).toBe('ao-thun-dep-2026');
  });
  it('parses attributes', () => {
    expect(parseAttributes('')).toEqual({});
    expect(parseAttributes('a=1, b = 2')).toEqual({ a: '1', b: '2' });
    expect(parseAttributes('novalue')).toBeNull();
    expect(parseAttributes('=x')).toBeNull();
  });
  it('parses stock', () => {
    expect(parseStock(' 12 ')).toBe(12);
    expect(parseStock('1e3')).toBeNull();
  });
});
