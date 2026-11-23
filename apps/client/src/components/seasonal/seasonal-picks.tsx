'use client';

import { ButtonLink } from '../common/button-link';
import { SectionHeading } from '../common/section-heading';
import { Container } from '../layout/container';
import { ProductCard } from '../product/product-card';
import { useT } from '../../i18n/locale-provider';
import { SEASONAL_VISUALS } from '../../lib/seasonal-themes';
import { products } from '../../mocks/products';
import type { DisplayedEvent } from '../../store/appearance-store';

const LIMIT = 4;

/** "Picks for <event>" — products from the categories that trend during the event. */
export function SeasonalPicks({ event }: { event: DisplayedEvent }) {
  const t = useT();
  const categories = SEASONAL_VISUALS[event.id].categories;
  const rank = (slug: string) => categories.indexOf(slug);
  const picks = products
    .filter((p) => rank(p.categorySlug) >= 0)
    .sort((a, b) => rank(a.categorySlug) - rank(b.categorySlug))
    .slice(0, LIMIT);
  if (picks.length === 0) return null;

  return (
    <Container as="section" className="pt-12 lg:pt-16">
      <SectionHeading
        title={t('seasonal.picksTitle', { event: t(`events.${event.id}.name`) })}
        action={
          <ButtonLink variant="outline" size="md" href={`/search?category=${categories[0]}`}>
            {t('common.viewAll')}
          </ButtonLink>
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
