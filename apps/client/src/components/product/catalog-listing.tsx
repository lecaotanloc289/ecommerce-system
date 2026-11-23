import type { ReactNode } from 'react';
import type { Currency, ProductSummaryPage } from '@repo/core';
import type { ProductFeed } from '../../lib/api/browser';
import type { CatalogFilters } from '../../lib/catalog-query';
import { PriceFilter, SortSelect } from './catalog-filters';
import { ProductFeedGrid } from './product-feed';

/** Products per page for every catalog list (first page in RSC, the rest via "load more"). */
export const CATALOG_PAGE_SIZE = 12;

/**
 * Filterable product list shared by category, "all products" and vendor pages (server
 * component). Filters live in the URL, so a change re-renders the page; the grid is keyed by
 * them to drop pages loaded under the previous filters.
 */
export function CatalogListing({
  page,
  feed,
  filters,
  currency,
  sidebar,
}: {
  page: ProductSummaryPage;
  feed: ProductFeed;
  filters: CatalogFilters;
  currency: Currency;
  /** Extra sidebar content above the price filter (e.g. subcategory links). */
  sidebar?: ReactNode;
}) {
  const key = JSON.stringify(filters);
  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-64">
        {sidebar}
        <PriceFilter key={key} filters={filters} currency={currency} />
      </aside>
      <div className="flex-1">
        <div className="mb-6 flex justify-end">
          <SortSelect filters={filters} currency={currency} />
        </div>
        <ProductFeedGrid key={key} initialPage={page} feed={feed} pageSize={CATALOG_PAGE_SIZE} />
      </div>
    </div>
  );
}
