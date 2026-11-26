'use client';

import * as React from 'react';
import { ProductSummaryPageSchema, type ProductSummary } from '@repo/core';
import { ButtonLink } from '../common/button-link';
import { SectionHeading } from '../common/section-heading';
import { Container } from '../layout/container';
import { ProductCard } from '../product/product-card';
import { useLocale } from '../../i18n/use-locale';
import { browserApi } from '../../lib/api/browser';
import { parseResult } from '../../lib/api/errors';
import { SEASONAL_VISUALS } from '../../lib/seasonal-themes';
import type { DisplayedEvent } from '../../store/appearance-store';

const LIMIT = 4;

/**
 * "Picks for <event>" — products from the categories that trend during the event, in the
 * event's category order (`GET /v1/products?categorySlug=` per category). Hidden while
 * loading, when no category exists in the catalog, or when the API fails.
 */
export function SeasonalPicks({ event }: { event: DisplayedEvent }) {
  const { locale, t } = useLocale();
  const categories = SEASONAL_VISUALS[event.id].categories;
  const [picks, setPicks] = React.useState<ProductSummary[]>([]);
  // "View all" opens the first category (in event order) that actually returned products.
  const [viewAllSlug, setViewAllSlug] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isCancelled = false;
    setPicks([]);
    setViewAllSlug(null);
    void Promise.all(
      categories.map(async (categorySlug) => {
        try {
          const page = parseResult(
            await browserApi().GET('/v1/products', {
              params: { query: { locale, categorySlug, limit: LIMIT } },
            }),
            ProductSummaryPageSchema,
          );
          return page.items;
        } catch {
          return [];
        }
      }),
    ).then((lists) => {
      if (isCancelled) return;
      const seen = new Set<string>();
      const merged = lists.flat().filter((p) => !seen.has(p.id) && seen.add(p.id));
      setPicks(merged.slice(0, LIMIT));
      setViewAllSlug(categories[lists.findIndex((items) => items.length > 0)] ?? null);
    });
    return () => {
      isCancelled = true;
    };
  }, [categories, locale]);

  if (picks.length === 0) return null;

  return (
    <Container as="section" className="pt-12 lg:pt-16">
      <SectionHeading
        title={t('seasonal.picksTitle', { event: t(`events.${event.id}.name`) })}
        action={
          viewAllSlug ? (
            <ButtonLink variant="outline" size="md" href={`/categories/${viewAllSlug}`}>
              {t('common.viewAll')}
            </ButtonLink>
          ) : undefined
        }
        className="mb-2"
      />
      <p className="mb-6 text-body-m text-text-muted">{t('seasonal.picksSubtitle')}</p>
      <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
        {picks.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </Container>
  );
}
