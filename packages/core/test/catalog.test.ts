import { describe, expect, it } from 'vitest';
import {
  CategoryNodeSchema,
  ProductListQuerySchema,
  RatingSummarySchema,
  SearchQuerySchema,
} from '../src';

const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('catalog schemas', () => {
  it('product list query applies defaults and coerces numbers', () => {
    const q = ProductListQuerySchema.parse({ minPrice: '1000', maxPrice: '5000' });
    expect(q).toMatchObject({ locale: 'vi', sort: 'newest', limit: 20, minPrice: 1000 });
  });

  it('rejects bad sort, locale, cursor and inverted price range', () => {
    expect(ProductListQuerySchema.safeParse({ sort: 'cheapest' }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({ locale: 'fr' }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({ minPrice: '9', maxPrice: '1' }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
    expect(ProductListQuerySchema.safeParse({ cursor: ulid }).success).toBe(true);
  });

  it('search needs a non-blank q', () => {
    expect(SearchQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(SearchQuerySchema.parse({ q: ' áo ' }).q).toBe('áo');
  });

  it('category node is recursive', () => {
    const leaf = { id: ulid, parentId: null, sortOrder: 0, name: 'A', slug: 'a', children: [] };
    expect(CategoryNodeSchema.safeParse({ ...leaf, children: [leaf] }).success).toBe(true);
    const bad = { ...leaf, slug: 'X' };
    expect(CategoryNodeSchema.safeParse({ ...leaf, children: [bad] }).success).toBe(false);
  });

  it('rating summary allows a null average (no reviews)', () => {
    const empty = { average: null, count: 0, distribution: [0, 0, 0, 0, 0] };
    expect(RatingSummarySchema.safeParse(empty).success).toBe(true);
  });
});
