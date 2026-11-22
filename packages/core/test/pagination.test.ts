import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, PageQuerySchema, PageSchema } from '../src/schemas';
import { ulid } from './fixtures';

describe('PageQuerySchema', () => {
  it('defaults the limit and coerces query-string numbers', () => {
    expect(PageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_LIMIT });
    expect(PageQuerySchema.parse({ cursor: ulid(1), limit: '5' })).toEqual({
      cursor: ulid(1),
      limit: 5,
    });
  });

  it.each([
    ['non-ULID cursor', { cursor: 'abc' }],
    ['zero limit', { limit: '0' }],
    ['limit above max', { limit: String(MAX_PAGE_LIMIT + 1) }],
    ['fractional limit', { limit: '2.5' }],
  ])('rejects %s', (_label, value) => {
    expect(PageQuerySchema.safeParse(value).success).toBe(false);
  });
});

describe('PageSchema', () => {
  const NumberPage = PageSchema(z.number());

  it('accepts items with a ULID or null cursor', () => {
    expect(NumberPage.safeParse({ items: [1, 2], nextCursor: ulid(2) }).success).toBe(true);
    expect(NumberPage.safeParse({ items: [], nextCursor: null }).success).toBe(true);
  });

  it('rejects wrong item types and a missing cursor', () => {
    expect(NumberPage.safeParse({ items: ['x'], nextCursor: null }).success).toBe(false);
    expect(NumberPage.safeParse({ items: [] }).success).toBe(false);
  });
});
