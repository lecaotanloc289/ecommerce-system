import {
  ProductDetailSchema,
  ProductSummaryPageSchema,
  ReviewPageSchema,
  VendorDetailSchema,
  type CatalogLocale,
  type ProductDetail,
  type ProductSummaryPage,
  type ReviewPage,
} from '@repo/core';
import { createAuthStore, type AuthStore } from '@/store/auth-store';
import type { CatalogFilters } from '../catalog-query';
import { browserApiOrigin } from './config';
import { ApiError, parseResult } from './errors';

/**
 * Browser-side API access. One auth store per tab (module singleton): its `api` client carries
 * the in-memory access token and refreshes on 401. Use it for mutations and signed-in reads;
 * catalog reads normally happen in RSC (`./server.ts`) — the helpers below are only for
 * client-driven paging ("load more") and add-to-cart lookups.
 */
let store: AuthStore | null = null;

export function getAuthStore(): AuthStore {
  store ??= createAuthStore({ baseUrl: browserApiOrigin() });
  return store;
}

export function browserApi(): AuthStore['api'] {
  return getAuthStore().api;
}

/** What a "load more" button pages through — mirrors the RSC list that rendered page 1. */
export type ProductFeed =
  | { kind: 'products'; locale: CatalogLocale; categorySlug?: string; filters: CatalogFilters }
  | { kind: 'search'; locale: CatalogLocale; q: string }
  | { kind: 'vendor'; locale: CatalogLocale; vendorSlug: string; filters: CatalogFilters };

/** Next page of a product feed (`cursor` = the previous page's `nextCursor`). */
export async function fetchProductPage(
  feed: ProductFeed,
  cursor: string,
  limit: number,
): Promise<ProductSummaryPage> {
  const api = browserApi();
  switch (feed.kind) {
    case 'products':
      return parseResult(
        await api.GET('/v1/products', {
          params: {
            query: {
              ...feed.filters,
              locale: feed.locale,
              ...(feed.categorySlug ? { categorySlug: feed.categorySlug } : {}),
              cursor,
              limit,
            },
          },
        }),
        ProductSummaryPageSchema,
      );
    case 'search':
      return parseResult(
        await api.GET('/v1/search', {
          params: { query: { q: feed.q, locale: feed.locale, cursor, limit } },
        }),
        ProductSummaryPageSchema,
      );
    case 'vendor': {
      const vendor = parseResult(
        await api.GET('/v1/vendors/{slug}', {
          params: {
            path: { slug: feed.vendorSlug },
            query: { ...feed.filters, locale: feed.locale, cursor, limit },
          },
        }),
        VendorDetailSchema,
      );
      return vendor.products;
    }
  }
}

/** Product detail (variants + stock) in the current locale; null when it is gone (404). */
export async function fetchProduct(
  slug: string,
  locale: CatalogLocale,
): Promise<ProductDetail | null> {
  const result = await browserApi().GET('/v1/products/{slug}', {
    params: { path: { slug }, query: { locale } },
  });
  if (result.response.status === 404) return null;
  return parseResult(result, ProductDetailSchema);
}

/** Next page of a product's reviews (newest first). */
export async function fetchReviews(productId: string, cursor: string): Promise<ReviewPage> {
  return parseResult(
    await browserApi().GET('/v1/products/{id}/reviews', {
      params: { path: { id: productId }, query: { cursor } },
    }),
    ReviewPageSchema,
  );
}

export { ApiError };
