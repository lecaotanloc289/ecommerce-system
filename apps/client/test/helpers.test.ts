import { describe, expect, it } from 'vitest';
import { normalizeApiOrigin } from '../src/lib/api/config';
import { errorCodeOf, parseResult, ApiError } from '../src/lib/api/errors';
import {
  catalogFiltersToQuery,
  parseCatalogFilters,
  toMajorUnits,
  toMinorUnits,
} from '../src/lib/catalog-query';
import { metaDescription } from '../src/lib/metadata';
import { ratingBars } from '../src/lib/reviews';
import { sanitizeReturnTo } from '../src/lib/return-to';

describe('sanitizeReturnTo', () => {
  it('keeps same-origin, locale-less paths with their query', () => {
    expect(sanitizeReturnTo('/cart')).toBe('/cart');
    expect(sanitizeReturnTo('/search?q=ao')).toBe('/search?q=ao');
    expect(sanitizeReturnTo('/')).toBe('/');
  });

  it('strips a locale prefix (navigation adds the current one)', () => {
    expect(sanitizeReturnTo('/vi/product/basic-tee')).toBe('/product/basic-tee');
    expect(sanitizeReturnTo('/en')).toBe('/');
    expect(sanitizeReturnTo('/vietnam')).toBe('/vietnam');
  });

  it('rejects open redirects and junk', () => {
    for (const bad of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      '/vi//evil.com',
      'cart',
      '',
      null,
      undefined,
      '/a\nb',
    ]) {
      expect(sanitizeReturnTo(bad)).toBeNull();
    }
  });

  it('never returns to the auth pages (would loop)', () => {
    expect(sanitizeReturnTo('/sign-in')).toBeNull();
    expect(sanitizeReturnTo('/en/auth/callback?error=x')).toBeNull();
    expect(sanitizeReturnTo('/register')).toBeNull();
  });
});

describe('catalog query mapping', () => {
  it('converts whole major units to integer minor units per currency', () => {
    expect(toMinorUnits(150_000, 'VND')).toBe(150_000);
    expect(toMinorUnits(12, 'USD')).toBe(1200);
    expect(toMajorUnits(1299, 'USD')).toBe(12);
  });

  it('parses sort + price range from search params', () => {
    expect(parseCatalogFilters({ sort: 'price_asc', min: '100', max: '500' }, 'USD')).toEqual({
      sort: 'price_asc',
      minPrice: 10_000,
      maxPrice: 50_000,
    });
  });

  it('ignores invalid values and swaps a reversed range', () => {
    expect(parseCatalogFilters({ sort: 'cheapest', min: '-5', max: '1.5' }, 'VND')).toEqual({
      sort: 'newest',
    });
    expect(parseCatalogFilters({ min: '900', max: '100' }, 'VND')).toEqual({
      sort: 'newest',
      minPrice: 100,
      maxPrice: 900,
    });
    expect(parseCatalogFilters({ sort: ['rating', 'newest'] }, 'VND').sort).toBe('rating');
  });

  it('round-trips filters to a short URL query', () => {
    const filters = parseCatalogFilters({ sort: 'rating', min: '5', max: '20' }, 'USD');
    expect(catalogFiltersToQuery(filters, 'USD')).toEqual({ sort: 'rating', min: '5', max: '20' });
    expect(catalogFiltersToQuery({ sort: 'newest' }, 'VND')).toEqual({});
  });
});

describe('api helpers', () => {
  it('normalizes the API origin (no trailing slash, no /v1)', () => {
    expect(normalizeApiOrigin('http://localhost:3001/v1')).toBe('http://localhost:3001');
    expect(normalizeApiOrigin(' https://api.example.com/ ')).toBe('https://api.example.com');
  });

  it('reads the errorCode of an error body', () => {
    expect(errorCodeOf({ errorCode: 'product.error.not-found', params: {} })).toBe(
      'product.error.not-found',
    );
    expect(errorCodeOf('oops')).toBeNull();
    expect(errorCodeOf({ errorCode: 42 })).toBeNull();
  });

  it('parseResult throws ApiError with status + code on a non-2xx reply', () => {
    const schema = { parse: (x: unknown) => x };
    const failed = {
      error: { errorCode: 'common.error.rate-limited', params: {} },
      response: new Response(null, { status: 429 }),
    };
    expect(() => parseResult(failed, schema)).toThrowError(ApiError);
    try {
      parseResult(failed, schema);
    } catch (e) {
      expect(e).toMatchObject({ status: 429, errorCode: 'common.error.rate-limited' });
    }
    expect(parseResult({ data: { a: 1 }, response: new Response('{}') }, schema)).toEqual({ a: 1 });
  });
});

describe('ratingBars', () => {
  it('orders 5★ → 1★ with whole percents', () => {
    expect(ratingBars({ distribution: [1, 0, 0, 1, 2] })).toEqual([
      { stars: 5, count: 2, percent: 50 },
      { stars: 4, count: 1, percent: 25 },
      { stars: 3, count: 0, percent: 0 },
      { stars: 2, count: 0, percent: 0 },
      { stars: 1, count: 1, percent: 25 },
    ]);
  });

  it('is all zero without reviews', () => {
    expect(ratingBars({ distribution: [0, 0, 0, 0, 0] }).every((b) => b.percent === 0)).toBe(true);
  });
});

describe('metaDescription', () => {
  it('flattens whitespace and cuts long text at a word boundary', () => {
    expect(metaDescription('  Soy   wax\ncandle ')).toBe('Soy wax candle');
    const long = 'word '.repeat(60);
    const out = metaDescription(long) ?? '';
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(metaDescription(null)).toBeUndefined();
  });
});
