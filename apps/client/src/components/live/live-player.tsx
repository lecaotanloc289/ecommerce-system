'use client';

import type { LiveSessionStatus } from '@repo/core';
import { useT } from '../../i18n/use-locale';
import type { MockLiveSession } from '../../mocks/live';
import { cn } from '../../lib/utils';

/** Only embed Cloudflare Stream players over https. */
function isTrustedPlayerUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.endsWith('.cloudflarestream.com');
  } catch {
    return false;
  }
}

/** Cloudflare Stream iframe player, or poster + reason when there is nothing to play. */
export function LivePlayer({
  session,
  status,
  className,
}: {
  session: MockLiveSession;
  /** Current status (may differ from `session.status` after a realtime event). */
  status: LiveSessionStatus;
  className?: string;
}) {
  const t = useT();
  const iframeUrl =
    session.playback && isTrustedPlayerUrl(session.playback.iframeUrl)
      ? session.playback.iframeUrl
      : null;

  let message: string | null = null;
  if (status === 'CANCELLED' || (status === 'ENDED' && session.status === 'LIVE')) {
    message = t('live.sessionEnded');
  } else if (status === 'SCHEDULED') message = t('live.notStarted');
  else if (!iframeUrl) {
    message = status === 'ENDED' ? t('live.replayProcessing') : t('live.playerUnavailable');
  }

  return (
    <div className={cn('relative overflow-hidden bg-black', className)}>
      {message || !iframeUrl ? (
        <>
          <img
            src={session.poster}
            alt=""
            decoding="async"
            className="size-full object-cover opacity-50"
          />
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-body-l font-medium text-white"
          >
            {message}
          </p>
        </>
      ) : (
        <iframe
          src={iframeUrl}
          title={session.title}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
        />
      )}
    </div>
  );
}
