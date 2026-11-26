'use client';

import * as React from 'react';
import { useRouter } from '@/i18n/navigation';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import {
  daysBetween,
  getSeasonalCalendar,
  toIsoDate,
  type CalendarDate,
  type SeasonalEventOccurrence,
} from '@repo/core';
import { Container } from '@/components/layout/container';
import { EventArt } from '@/components/seasonal/event-art';
import { SeasonalEffects } from '@/components/seasonal/seasonal-effects';
import { intlLocale } from '@repo/i18n';
import { useLocale } from '@/i18n/use-locale';
import { countdownLabel, formatCalendarDate, lunarLabel } from '@/lib/seasonal-format';
import { cn } from '@/lib/utils';
import { useAppearance } from '@/store/appearance-store';

/** Years browsable either side of today — lunar dates stay well inside the algorithm's range. */
const YEAR_SPAN = 5;

type Status = 'now' | 'upcoming' | 'ended';

function statusOf(o: SeasonalEventOccurrence, today: CalendarDate): Status {
  if (daysBetween(today, o.start) > 0) return 'upcoming';
  if (daysBetween(today, o.end) < 0) return 'ended';
  return 'now';
}

const STATUS_STYLE: Readonly<Record<Status, string>> = {
  now: 'bg-brand-solid text-text-on-primary',
  upcoming: 'bg-brand-soft text-brand-text',
  ended: 'bg-bg-muted text-text-muted',
};

/** Yearly events calendar: every themed holiday with dates (lunar ones converted), status and a theme preview. */
export default function EventsPage() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const { today, setPreview } = useAppearance();
  const [year, setYear] = React.useState<number | null>(null);
  const shownYear = year ?? today?.year ?? null;

  const calendar = React.useMemo(
    () => (shownYear === null ? [] : getSeasonalCalendar(shownYear)),
    [shownYear],
  );

  const monthName = (month: number) =>
    new Intl.DateTimeFormat(intlLocale(locale), { month: 'long' }).format(
      new Date(Date.UTC(2000, month - 1, 15)),
    );

  const byMonth = React.useMemo(() => {
    const groups = new Map<number, SeasonalEventOccurrence[]>();
    for (const o of calendar) groups.set(o.date.month, [...(groups.get(o.date.month) ?? []), o]);
    return [...groups];
  }, [calendar]);

  const preview = (o: SeasonalEventOccurrence) => {
    setPreview(o.id);
    router.push('/');
  };

  const statusLabel = (o: SeasonalEventOccurrence, status: Status, now: CalendarDate) => {
    if (status === 'ended') return t('seasonal.ended');
    if (status === 'upcoming') {
      return t('seasonal.startsOn', { date: formatCalendarDate(o.start, locale) });
    }
    return countdownLabel(daysBetween(now, o.date), o.end, locale, t);
  };

  return (
    <>
      <SeasonalEffects />
      <Container as="section" className="py-10 lg:py-14">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
              {shownYear === null
                ? t('seasonal.navEvents')
                : t('seasonal.calendarTitle', { year: shownYear })}
            </h1>
            <p className="max-w-2xl text-body-m text-text-muted">
              {t('seasonal.calendarSubtitle')}
            </p>
          </div>
          {shownYear === null ? null : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setYear(shownYear - 1)}
                disabled={today !== null && shownYear <= today.year - YEAR_SPAN}
                aria-label={t('seasonal.prevYear')}
                className="flex size-9 items-center justify-center rounded-full border border-border-default bg-bg-elevated text-text-muted transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:text-text-disabled"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-14 text-center font-heading text-h6 font-bold text-text-primary">
                {shownYear}
              </span>
              <button
                type="button"
                onClick={() => setYear(shownYear + 1)}
                disabled={today !== null && shownYear >= today.year + YEAR_SPAN}
                aria-label={t('seasonal.nextYear')}
                className="flex size-9 items-center justify-center rounded-full border border-border-default bg-bg-elevated text-text-muted transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:text-text-disabled"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>

        {today === null ? (
          <p className="text-body-m text-text-muted">{t('common.loading')}</p>
        ) : (
          <div className="flex flex-col gap-10">
            {byMonth.map(([month, items]) => (
              <section key={month} aria-labelledby={`month-${month}`}>
                <h2
                  id={`month-${month}`}
                  className="mb-4 border-b border-border-faint pb-2 font-heading text-h6 font-bold capitalize text-text-primary"
                >
                  {monthName(month)}
                </h2>
                <ul className="grid gap-4 md:grid-cols-2">
                  {items.map((o) => {
                    const status = statusOf(o, today);
                    const lunar = lunarLabel(o.id, t);
                    return (
                      <li
                        key={o.id}
                        className={cn(
                          'flex gap-4 rounded-lg border bg-bg-elevated p-4',
                          status === 'now' ? 'border-brand-solid shadow-1' : 'border-border-subtle',
                        )}
                      >
                        <EventArt
                          eventId={o.id}
                          compact
                          className={cn(
                            'w-24 shrink-0 sm:w-28',
                            status === 'ended' && 'opacity-60',
                          )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2.5 py-0.5 text-body-s font-semibold',
                                STATUS_STYLE[status],
                              )}
                            >
                              {status === 'now'
                                ? t('seasonal.happeningNow')
                                : statusLabel(o, status, today)}
                            </span>
                            {status === 'now' ? (
                              <span className="text-body-s font-medium text-brand-text">
                                {statusLabel(o, status, today)}
                              </span>
                            ) : null}
                          </div>
                          <h3 className="text-body-l font-semibold text-text-primary">
                            {t(`events.${o.id}.name`)}
                          </h3>
                          <p className="text-body-s text-text-muted">
                            <time dateTime={toIsoDate(o.date)}>
                              {formatCalendarDate(o.date, locale)}
                            </time>
                            {lunar ? ` · ${lunar}` : null}
                          </p>
                          <p className="text-body-s text-text-body">
                            {t(`events.${o.id}.description`)}
                          </p>
                          <button
                            type="button"
                            onClick={() => preview(o)}
                            className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md text-body-s font-medium text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                          >
                            <Eye className="size-4" aria-hidden />
                            {t('seasonal.previewTheme')}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Container>
    </>
  );
}
