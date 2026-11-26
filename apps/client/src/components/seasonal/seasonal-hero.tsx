'use client';

import { ButtonLink } from '../common/button-link';
import { Container } from '../layout/container';
import { useLocale } from '../../i18n/use-locale';
import { SEASONAL_VISUALS } from '../../lib/seasonal-themes';
import { countdownLabel, formatCalendarDate, lunarLabel } from '../../lib/seasonal-format';
import { toIsoDate } from '@repo/core';
import type { DisplayedEvent } from '../../store/appearance-store';
import { EventArt } from './event-art';

/**
 * Home hero for the running (or previewed) event — replaces the product carousel while a
 * season is on. Painted with brand tokens, so it follows the event accent automatically.
 */
export function SeasonalHero({ event }: { event: DisplayedEvent }) {
  const { locale, t } = useLocale();
  const lunar = lunarLabel(event.id, t);
  const category = SEASONAL_VISUALS[event.id].categories[0];

  return (
    <Container as="section" className="pt-6 lg:pt-8">
      <div className="grid animate-[elmaFade_500ms_ease-out] items-center gap-6 overflow-hidden rounded-xl bg-brand-soft px-6 py-8 motion-reduce:animate-none sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:py-10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-body-s">
            <span className="rounded-full bg-brand-solid px-3 py-1 font-semibold text-text-on-primary">
              {event.isPreview
                ? t('seasonal.previewTheme')
                : countdownLabel(event.daysUntil, event.end, locale, t)}
            </span>
            <span className="font-medium text-brand-text">
              <time dateTime={toIsoDate(event.date)}>{formatCalendarDate(event.date, locale)}</time>
              {lunar ? ` · ${lunar}` : null}
            </span>
          </div>
          <h1 className="font-heading text-h2-alt font-bold tracking-tight text-text-primary sm:text-h2">
            {t(`events.${event.id}.name`)}
          </h1>
          <p className="font-heading text-h5 font-semibold text-brand-text">
            {t(`events.${event.id}.tagline`)}
          </p>
          <p className="max-w-lg text-body-l text-text-muted">
            {t(`events.${event.id}.description`)}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <ButtonLink size="lg" href={category ? `/search?category=${category}` : '/search'}>
              {t('seasonal.shopNow')}
            </ButtonLink>
            <ButtonLink size="lg" variant="outline" href="/events">
              {t('seasonal.viewCalendar')}
            </ButtonLink>
          </div>
        </div>
        <EventArt eventId={event.id} className="mx-auto max-w-md" />
      </div>
    </Container>
  );
}
