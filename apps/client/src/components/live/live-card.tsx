'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import { formatDate } from '@repo/i18n';
import { LiveBadge } from './live-badge';
import { ViewerCount } from './viewer-count';
import { useLocale } from '../../i18n/locale-provider';
import { formatDateTime } from '../../lib/live';
import type { MockLiveSession } from '../../mocks/live';

export function LiveCard({ session }: { session: MockLiveSession }) {
  const { locale, t } = useLocale();
  const isReplay = session.status === 'ENDED';

  return (
    <Link
      href={`/live/${session.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated transition-shadow hover:shadow-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      <div className="relative">
        <img
          src={session.poster}
          alt=""
          className="aspect-[3/4] w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <LiveBadge status={session.status} />
          {session.status === 'LIVE' ? (
            <ViewerCount
              count={session.peakViewers}
              className="rounded-sm bg-black/60 px-1.5 py-1 text-white"
            />
          ) : null}
        </div>
        {isReplay ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-bg-elevated/90 text-text-primary">
              <Play className="size-5" aria-hidden />
            </span>
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 text-body-m font-medium text-text-primary transition-colors group-hover:text-brand-text">
          {session.title}
        </h3>
        <span className="text-body-s text-text-muted">
          {t('live.byVendor', { vendor: session.vendorName })}
        </span>
        <span className="mt-auto pt-1 text-body-s text-text-body">
          {session.status === 'SCHEDULED' && session.scheduledAt
            ? t('live.startsAt', { time: formatDateTime(session.scheduledAt, locale) })
            : null}
          {isReplay && session.endedAt
            ? t('live.streamedOn', { date: formatDate(session.endedAt, locale) })
            : null}
        </span>
      </div>
    </Link>
  );
}
