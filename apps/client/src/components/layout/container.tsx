import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Centered content column. Kit content width = 1110px (DESIGN.md §5). */
export function Container({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'footer' | 'main' | 'nav';
}) {
  return (
    <Tag className={cn('mx-auto w-full max-w-[1110px] px-4 sm:px-6 lg:px-8', className)}>
      {children}
    </Tag>
  );
}
