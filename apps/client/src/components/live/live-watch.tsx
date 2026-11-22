'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { formatDate } from '@repo/i18n';
import { Container } from '../layout/container';
import { LiveBadge } from './live-badge';
import { LiveChatComposer, LiveChatMessages } from './live-chat';
import { LivePlayer } from './live-player';
import { LiveProductsDrawer } from './live-products-drawer';
import { PinnedProductCard } from './pinned-product-card';
import { FloatingHearts, ReactionButton } from './reaction-button';
import { ViewerCount } from './viewer-count';
import { useLocale } from '../../i18n/locale-provider';
import { formatDateTime } from '../../lib/live';
import { useLiveEvents } from '../../lib/live-events';
import { useMediaQuery } from '../../lib/use-media-query';
import { mockLiveUser, type MockLiveSession } from '../../mocks/live';
import { products } from '../../mocks/products';

export function LiveWatch({ session }: { session: MockLiveSession }) {
  const { locale, t } = useLocale();
  const live = useLiveEvents(session.id);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isLive = live.status === 'LIVE';
  const pinned = live.pinnedProductId
    ? products.find((p) => p.id === live.pinnedProductId)
    : undefined;

  const composer = (
    <LiveChatComposer
      isSignedIn={mockLiveUser.isSignedIn}
      onSend={live.sendMessage}
      actions={<ReactionButton onReact={() => live.sendReaction('HEART')} />}
    />
  );

  const metaParts = [
    t('live.byVendor', { vendor: session.vendorName }),
    live.status === 'SCHEDULED' && session.scheduledAt
      ? t('live.startsAt', { time: formatDateTime(session.scheduledAt, locale) })
      : null,
    live.status === 'ENDED' && session.endedAt
      ? t('live.streamedOn', { date: formatDate(session.endedAt, locale) })
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <Container as="section" className="py-4 lg:py-8">
      <Link
        href="/live"
        className="mb-3 inline-flex items-center gap-1.5 text-body-s text-text-muted hover:text-brand-text"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('live.listTitle')}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Mobile: tall frame, message list overlaid (never the controls); desktop: 16:9. */}
          <div className="relative overflow-hidden rounded-lg">
            <LivePlayer
              session={session}
              status={live.status}
              className="aspect-[9/16] max-h-[75svh] w-full lg:aspect-video lg:max-h-none"
            />
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
              <LiveBadge status={live.status} />
              {isLive ? (
                <ViewerCount
                  count={live.viewers}
                  className="rounded-sm bg-black/60 px-1.5 py-1 text-white"
                />
              ) : null}
            </div>
            {isLive ? <FloatingHearts burst={live.burst} /> : null}
            {isLive && !isDesktop ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-12 bg-gradient-to-t from-black/50 to-transparent pt-8">
                <LiveChatMessages messages={live.messages} variant="overlay" />
              </div>
            ) : null}
          </div>

          {isLive && !isDesktop ? composer : null}

          <div>
            <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary">
              {session.title}
            </h1>
            <p className="mt-1 text-body-s text-text-muted">{metaParts.join(' · ')}</p>
          </div>

          {pinned && isLive ? <PinnedProductCard product={pinned} highlighted /> : null}
          <div>
            <LiveProductsDrawer
              productIds={live.productIds}
              pinnedProductId={isLive ? live.pinnedProductId : null}
            />
          </div>
        </div>

        {isLive && isDesktop ? (
          <aside
            aria-label={t('live.chatTitle')}
            className="flex h-[min(640px,calc(100svh-8rem))] min-h-0 flex-col rounded-lg border border-border-subtle bg-bg-elevated"
          >
            <h2 className="border-b border-border-faint px-4 py-3 text-body-m font-semibold text-text-primary">
              {t('live.chatTitle')}
            </h2>
            <LiveChatMessages messages={live.messages} variant="panel" />
            <div className="border-t border-border-faint p-3">{composer}</div>
          </aside>
        ) : null}
      </div>
    </Container>
  );
}
