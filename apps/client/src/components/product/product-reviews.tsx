'use client';

import * as React from 'react';
import { Button } from '@repo/ui';
import type { RatingSummary, Review, ReviewPage } from '@repo/core';
import { formatDate } from '@repo/i18n';
import { StarRating } from './star-rating';
import { useLocale } from '../../i18n/use-locale';
import { fetchReviews } from '../../lib/api/browser';
import { ratingBars } from '../../lib/reviews';

/**
 * Rating summary + review list (`GET /v1/products/:id/reviews`), first page from the RSC page,
 * more pages on demand. Writing a review happens from a delivered order (T5.2).
 */
export function ProductReviews({
  productId,
  initialPage,
  fallbackSummary,
}: {
  productId: string;
  /** null when the reviews request 404'd (product hidden meanwhile). */
  initialPage: ReviewPage | null;
  fallbackSummary: RatingSummary;
}) {
  const { locale, t } = useLocale();
  const summary = initialPage?.summary ?? fallbackSummary;
  const [items, setItems] = React.useState<Review[]>(initialPage?.items ?? []);
  const [cursor, setCursor] = React.useState(initialPage?.nextCursor ?? null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchReviews(productId, cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.items.filter((r) => !seen.has(r.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="grid items-center gap-8 rounded-xl border border-border-subtle bg-bg-muted/30 p-6 sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-h1 font-bold text-text-primary">
            {summary.average === null ? '–' : summary.average.toFixed(1)}
          </span>
          <StarRating value={summary.average ?? 0} size="md" />
          <span className="text-body-s text-text-muted">
            {t('product.of5')} · {t('product.reviewsCount', { count: summary.count })}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {ratingBars(summary).map(({ stars, count, percent }) => (
            <div key={stars} className="flex items-center gap-3">
              <span className="w-6 text-body-s text-text-muted">{stars}★</span>
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-bg-muted"
                role="img"
                aria-label={t('product.ratingBar', { stars, count })}
              >
                <div
                  className="h-full rounded-full bg-success-solid"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-10 text-right text-body-s text-text-muted">{percent}%</span>
            </div>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-body-m text-text-muted">{t('product.noReviews')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-faint">
          {items.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-5 first:pt-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-body-s font-semibold text-brand-text"
                  >
                    {r.authorName.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-body-m font-medium text-text-primary">{r.authorName}</p>
                    <span className="text-body-s text-text-muted">
                      {formatDate(r.createdAt, locale)}
                    </span>
                  </div>
                </div>
                <StarRating value={r.rating} />
              </div>
              {r.body ? (
                <p className="whitespace-pre-line text-body-m text-text-body">{r.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <div className="flex flex-col items-start gap-2">
          <Button variant="outline" size="md" disabled={loading} onClick={() => void loadMore()}>
            {loading ? t('common.loading') : t('product.moreReviews')}
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
