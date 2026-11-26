'use client';

import { Star } from 'lucide-react';
import { useT } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

/** Read-only star rating. Half-stars approximated by rounding to nearest 0.5. */
export function StarRating({
  value,
  count,
  size = 'sm',
  className,
}: {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  className?: string | undefined;
}) {
  const t = useT();
  const px = size === 'sm' ? 'size-3.5' : 'size-5';
  const rounded = Math.round(value * 2) / 2;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div
        className="flex items-center"
        role="img"
        aria-label={t('product.ratingLabel', { value })}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const filled = i + 1 <= rounded;
          const half = !filled && i + 0.5 === rounded;
          return (
            <Star
              key={i}
              className={cn(
                px,
                filled || half
                  ? 'fill-warning-solid text-warning-solid'
                  : 'fill-transparent text-border-default',
              )}
              aria-hidden
            />
          );
        })}
      </div>
      {count !== undefined ? <span className="text-body-s text-text-muted">({count})</span> : null}
    </div>
  );
}
