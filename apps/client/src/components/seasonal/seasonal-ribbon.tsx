'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowRight, X } from 'lucide-react';
import { toIsoDate } from '@repo/core';
import { Container } from '../layout/container';
import { useLocale } from '../../i18n/use-locale';
import { SEASONAL_VISUALS } from '../../lib/seasonal-themes';
import { countdownLabel } from '../../lib/seasonal-format';
import { useAppearance } from '../../store/appearance-store';
import { readStored, writeStored } from '../../store/persisted';
import { MotifIcon } from './motifs';

const DISMISS_KEY = 'seasonal-ribbon-dismissed';

/**
 * Slim announcement bar under the navbar while an event runs (or is previewed).
 * Dismissal lasts for the tab session and only for that occurrence of the event.
 */
export function SeasonalRibbon() {
  const { locale, t } = useLocale();
  const { event, setPreview } = useAppearance();
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  React.useEffect(() => {
    const stored = readStored('session', DISMISS_KEY);
    if (typeof stored === 'string') setDismissed(stored);
  }, []);

  if (!event) return null;
  const occurrenceKey = `${event.id}@${toIsoDate(event.date)}`;
  if (!event.isPreview && dismissed === occurrenceKey) return null;

  const name = t(`events.${event.id}.name`);
  const motif = SEASONAL_VISUALS[event.id].motifs[0];

  return (
    <div className="bg-brand-solid text-text-on-primary">
      <Container className="flex min-h-10 items-center gap-3 py-1.5 text-body-s">
        <MotifIcon motif={motif} className="size-5" />
        {event.isPreview ? (
          <>
            <p className="min-w-0 flex-1 truncate font-medium">
              {t('seasonal.previewing', { event: name })}
            </p>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="shrink-0 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-on-primary"
            >
              {t('seasonal.exitPreview')}
            </button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{name}</span>
              <span aria-hidden> · </span>
              <span>{t(`events.${event.id}.offer`)}</span>
              <span aria-hidden> · </span>
              <span className="font-medium">
                {countdownLabel(event.daysUntil, event.end, locale, t)}
              </span>
            </p>
            <Link
              href="/events"
              className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-on-primary sm:inline-flex"
            >
              {t('seasonal.viewCalendar')} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => {
                setDismissed(occurrenceKey);
                writeStored('session', DISMISS_KEY, occurrenceKey);
              }}
              aria-label={t('seasonal.dismiss')}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-brand-solid-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-on-primary"
            >
              <X className="size-4" aria-hidden />
            </button>
          </>
        )}
      </Container>
    </div>
  );
}
