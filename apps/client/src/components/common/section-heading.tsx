import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Section title row used across landing/list sections. Heading = Rubik via
 * `font-heading`; `text-h3`/`text-h4` carry their matched line-height (tokens.css).
 */
export function SectionHeading({
  title,
  action,
  className,
  align = 'between',
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  align?: 'between' | 'center';
}) {
  if (align === 'center') {
    return (
      <div className={cn('mb-8 flex flex-col items-center gap-2 text-center', className)}>
        <h2 className="font-heading text-h4 font-bold tracking-tight text-text-primary md:text-h3">
          {title}
        </h2>
      </div>
    );
  }
  return (
    <div className={cn('mb-6 flex items-end justify-between gap-4', className)}>
      <h2 className="font-heading text-h4 font-bold tracking-tight text-text-primary md:text-h3">
        {title}
      </h2>
      {action}
    </div>
  );
}
