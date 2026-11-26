'use client';

import { Badge } from '@repo/ui';
import type { LiveSessionStatus } from '@repo/core';
import { useT } from '../../i18n/use-locale';

/** "LIVE" pill; only a running session gets a badge. */
export function LiveBadge({
  status,
  className,
}: {
  status: LiveSessionStatus;
  className?: string;
}) {
  const t = useT();
  if (status !== 'LIVE') return null;
  return (
    <Badge variant="solid" className={className}>
      <span aria-hidden className="size-1.5 rounded-full bg-text-on-primary" />
      {t('live.badgeLive')}
    </Badge>
  );
}
