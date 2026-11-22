'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import type { ProductSummaryPage } from '@repo/core';
import { ProductCard } from './product-card';
import { useT } from '../../i18n/use-locale';
import { fetchProductPage, type ProductFeed } from '../../lib/api/browser';
import { cn } from '../../lib/utils';

/**
 * Product grid whose first page is rendered by the RSC page; "Load more" fetches the next
 * cursor page in the browser (public endpoint, no auth). Key it by the query so a filter
 * change (new server render) resets the accumulated pages.
 */
export function ProductFeedGrid({
  initialPage,
  feed,
  pageSize,
  className,
}: {
  initialPage: ProductSummaryPage;
  feed: ProductFeed;
  pageSize: number;
  className?: string;
}) {
  const t = useT();
  const [items, setItems] = React.useState(initialPage.items);
  const [cursor, setCursor] = React.useState(initialPage.nextCursor);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchProductPage(feed, cursor, pageSize);
      // A product can move between pages while paging; never render it twice.
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return <p className="py-16 text-center text-body-m text-text-muted">{t('search.noResults')}</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className={cn('grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3', className)}>
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      {cursor ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void loadMore()}
          >
            {loading ? t('common.loading') : t('catalog.loadMore')}
          </Button>
          {failed ? (
            <p role="alert" className="text-body-s text-danger-fg">
              {t('catalog.loadMoreFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
