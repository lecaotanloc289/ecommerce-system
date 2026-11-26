import { cache } from 'react';
import { notFound } from 'next/navigation';
import createClient from 'openapi-fetch';
import type { paths } from '@repo/sdk';
import {
  CategoryDetailSchema,
  CategoryTreeSchema,
  PlatformSettingsPublicSchema,
  ProductDetailSchema,
  ProductSummaryPageSchema,
  ReviewPageSchema,
  VendorDetailSchema,
  type CatalogLocale,
  type CategoryDetail,
  type CategoryTree,
  type PlatformSettingsPublic,
  type ProductDetail,
  type ProductSummaryPage,
  type ReviewPage,
  type VendorDetail,
} from '@repo/core';
import type { CatalogFilters } from '../catalog-query';
import { serverApiOrigin } from './config';
import { parseResult, type FetchResult, type ResponseSchema } from './errors';

/**
 * Server-side (RSC / `generateMetadata`) catalog reads. Public endpoints only — no auth, no
 * cookies forwarded. Every function is wrapped in React `cache()`, so a page and its
 * `generateMetadata` (or two components) asking for the same data in one request share one
 * API call: SSR traffic shares the Worker egress IP's rate-limit bucket on the API.
 *
 * Pages that call these must render dynamically (`export const dynamic = 'force-dynamic'`):
 * OpenNext runs with a read-only static-assets incremental cache, so ISR / `revalidate` would
 * never refresh. Calls use plain openapi-fetch (not `createApiClient`): no `credentials`, no
 * Idempotency-Key, no refresh — none apply to anonymous GETs from the server.
 *
 * Errors: a 404 calls `notFound()`; any other non-2xx throws `ApiError` (→ `error.tsx`).
 */
function client() {
  return createClient<paths>({ baseUrl: serverApiOrigin() });
}

async function read<T>(call: Promise<FetchResult>, schema: ResponseSchema<T>): Promise<T> {
  const result = await call;
  if (result.response.status === 404) notFound();
  return parseResult(result, schema);
}

/** Like `read`, but a 404 is returned as `null` (for optional data that must not 404 the page). */
async function readOptional<T>(
  call: Promise<FetchResult>,
  schema: ResponseSchema<T>,
): Promise<T | null> {
  const result = await call;
  if (result.response.status === 404) return null;
  return parseResult(result, schema);
}

export interface ProductListParams extends Partial<CatalogFilters> {
  locale: CatalogLocale;
  categorySlug?: string;
  vendorSlug?: string;
  limit?: number;
  cursor?: string;
}

export const getCategoryTree = cache(
  (locale: CatalogLocale): Promise<CategoryTree> =>
    read(client().GET('/v1/categories', { params: { query: { locale } } }), CategoryTreeSchema),
);

export const getCategory = cache(
  (slug: string, locale: CatalogLocale): Promise<CategoryDetail> =>
    read(
      client().GET('/v1/categories/{slug}', { params: { path: { slug }, query: { locale } } }),
      CategoryDetailSchema,
    ),
);

export const getProduct = cache(
  (slug: string, locale: CatalogLocale): Promise<ProductDetail> =>
    read(
      client().GET('/v1/products/{slug}', { params: { path: { slug }, query: { locale } } }),
      ProductDetailSchema,
    ),
);

export const getProductReviews = cache(
  (productId: string): Promise<ReviewPage | null> =>
    readOptional(
      client().GET('/v1/products/{id}/reviews', { params: { path: { id: productId } } }),
      ReviewPageSchema,
    ),
);

export const getPublicSettings = cache(
  (): Promise<PlatformSettingsPublic> =>
    read(client().GET('/v1/platform-settings/public'), PlatformSettingsPublicSchema),
);

// cache() keys on argument identity, so object params get a per-request map keyed by JSON.
const listMemo = cache(() => new Map<string, Promise<ProductSummaryPage>>());
const vendorMemo = cache(() => new Map<string, Promise<VendorDetail>>());

function memoize<T>(
  memo: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = memo.get(key);
  if (hit) return hit;
  const promise = load();
  memo.set(key, promise);
  return promise;
}

/** `GET /v1/products` — newest / filtered / category / vendor lists. */
export function listProducts(params: ProductListParams): Promise<ProductSummaryPage> {
  return memoize(listMemo(), JSON.stringify(params), () =>
    read(client().GET('/v1/products', { params: { query: params } }), ProductSummaryPageSchema),
  );
}

export const searchProducts = cache(
  (q: string, locale: CatalogLocale, limit: number): Promise<ProductSummaryPage> =>
    read(
      client().GET('/v1/search', { params: { query: { q, locale, limit } } }),
      ProductSummaryPageSchema,
    ),
);

/** `GET /v1/vendors/:slug` — shop header + first page of its products. */
export function getVendor(
  slug: string,
  params: Omit<ProductListParams, 'vendorSlug' | 'categorySlug'>,
): Promise<VendorDetail> {
  return memoize(vendorMemo(), JSON.stringify({ slug, params }), () =>
    read(
      client().GET('/v1/vendors/{slug}', { params: { path: { slug }, query: params } }),
      VendorDetailSchema,
    ),
  );
}
