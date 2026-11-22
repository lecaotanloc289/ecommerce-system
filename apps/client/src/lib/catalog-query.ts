import { PRODUCT_SORTS, type Currency, type ProductSort } from '@repo/core';

/** Next.js `searchParams` value shape. */
export type SearchParamsRecord = Readonly<Record<string, string | string[] | undefined>>;

/** Minor units per major unit (VND has no fraction, USD = cents). */
const MINOR_PER_MAJOR: Readonly<Record<Currency, number>> = { VND: 1, USD: 100 };

/**
 * Catalog list filters as the API takes them: prices are integer minor units of `currency`
 * (Golden Rule #2). The URL carries whole major units (`?min=100000&max=500000`), which is
 * what a shopper types; conversion happens only here.
 */
export interface CatalogFilters {
  sort: ProductSort;
  minPrice?: number;
  maxPrice?: number;
}

export const DEFAULT_SORT: ProductSort = 'newest';

/** First value of a search param (`?a=1&a=2` → `'1'`). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isProductSort(value: string | undefined): value is ProductSort {
  return PRODUCT_SORTS.some((s) => s === value);
}

/** A non-negative whole number of major units, or undefined for anything else. */
function parseMajor(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,12}$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/** Whole major units → integer minor units (e.g. 12 USD → 1200). */
export function toMinorUnits(major: number, currency: Currency): number {
  return major * MINOR_PER_MAJOR[currency];
}

/** Integer minor units → whole major units for an input field (fraction dropped). */
export function toMajorUnits(minor: number, currency: Currency): number {
  return Math.floor(minor / MINOR_PER_MAJOR[currency]);
}

/** URL search params → API filters. Unknown/invalid values are ignored; a reversed range is swapped. */
export function parseCatalogFilters(
  params: SearchParamsRecord,
  currency: Currency,
): CatalogFilters {
  const sortParam = firstParam(params.sort);
  const sort = isProductSort(sortParam) ? sortParam : DEFAULT_SORT;
  let min = parseMajor(firstParam(params.min));
  let max = parseMajor(firstParam(params.max));
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const filters: CatalogFilters = { sort };
  if (min !== undefined) filters.minPrice = toMinorUnits(min, currency);
  if (max !== undefined) filters.maxPrice = toMinorUnits(max, currency);
  return filters;
}

/**
 * Filters → URL query (major units), omitting defaults so the canonical URL stays short.
 * Inverse of `parseCatalogFilters` for whole-unit prices.
 */
export function catalogFiltersToQuery(
  filters: CatalogFilters,
  currency: Currency,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.sort !== DEFAULT_SORT) query.sort = filters.sort;
  if (filters.minPrice !== undefined) {
    query.min = String(toMajorUnits(filters.minPrice, currency));
  }
  if (filters.maxPrice !== undefined) {
    query.max = String(toMajorUnits(filters.maxPrice, currency));
  }
  return query;
}
