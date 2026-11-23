import { Fragment } from 'react';
import { Link } from '@/i18n/navigation';
import { cn } from '../../lib/utils';

export interface Crumb {
  label: string;
  /** Locale-less path; omit for the current page (last crumb). */
  href?: string;
}

/** Breadcrumb trail; the last crumb is the current page. Server- and client-safe. */
export function Breadcrumb({
  items,
  label,
  className,
}: {
  items: Crumb[];
  /** Accessible name of the nav landmark. */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('text-body-s text-text-muted', className)}>
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, i) => (
          <Fragment key={`${item.href ?? ''}-${item.label}`}>
            {i > 0 ? (
              <li aria-hidden className="select-none">
                /
              </li>
            ) : null}
            <li>
              {item.href ? (
                <Link href={item.href} className="hover:text-brand-text">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="text-text-body">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
