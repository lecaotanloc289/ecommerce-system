'use client';

import { Eye } from 'lucide-react';
import { formatCompact } from '@repo/i18n';
import { useLocale } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

export function ViewerCount({ count, className }: { count: number; className?: string }) {
  const { locale, t } = useLocale();
  return (
    <span className={cn('inline-flex items-center gap-1 text-body-s', className)}>
      <Eye className="size-3.5" aria-hidden />
      {t('live.viewers', { count: formatCompact(count, locale) })}
    </span>
  );
}
