import { describe, expect, it } from 'vitest';
import { createTranslator, interpolate, translateError } from '../src/translator';

describe('interpolate', () => {
  it('fills known placeholders and keeps unknown ones visible', () => {
    expect(interpolate('Hi {name}, {count} items', { name: 'An', count: 3 })).toBe(
      'Hi An, 3 items',
    );
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
    expect(interpolate('Hi {name}')).toBe('Hi {name}');
  });

  it('does not read inherited properties', () => {
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });
});

describe('createTranslator', () => {
  it('resolves dot paths per locale', () => {
    expect(createTranslator('en')('common.addToCart')).toBe('Add to cart');
    expect(createTranslator('vi')('common.addToCart')).toBe('Thêm vào giỏ');
  });

  it('interpolates params', () => {
    expect(createTranslator('en')('product.reviewsCount', { count: 12 })).toBe('12 reviews');
    expect(createTranslator('vi')('product.reviewsCount', { count: 12 })).toBe('12 đánh giá');
  });

  it('returns the key when the path is not a string leaf', () => {
    // Keys can arrive as data at runtime; the MessageKey type forbids these literals at compile time.
    const lookup = createTranslator('en') as (key: string) => string;
    expect(lookup('common.nope')).toBe('common.nope');
    expect(lookup('common')).toBe('common');
    expect(lookup('common.addToCart.extra')).toBe('common.addToCart.extra');
    expect(lookup('__proto__.toString')).toBe('__proto__.toString');
  });
});

describe('translateError', () => {
  it('translates a core error code in both locales', () => {
    expect(translateError('en', 'checkout.error.out-of-stock')).toMatch(/out of stock/i);
    expect(translateError('vi', 'checkout.error.out-of-stock')).toMatch(/hết hàng/);
  });

  it('falls back to the generic internal error for codes this bundle does not know', () => {
    const generic = translateError('en', 'common.error.internal');
    expect(translateError('en', 'checkout.error.added-in-a-newer-server')).toBe(generic);
    expect(translateError('en', 'toString', { a: 1 })).toBe(generic);
    expect(translateError('vi', '')).toBe(translateError('vi', 'common.error.internal'));
  });
});
