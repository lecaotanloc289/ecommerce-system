'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const tagVariants = cva(
  ['inline-flex items-center gap-1.5 font-medium', 'transition-colors duration-150'].join(' '),
  {
    variants: {
      variant: {
        neutral:
          'bg-[var(--color-slate-2)] text-[var(--color-text-body)] border border-[var(--color-border-default)]',
        plain: 'bg-[var(--color-slate-2)] text-[var(--color-text-body)]',
        brand:
          'bg-[var(--color-brand-soft)] text-[var(--color-brand-text)] border border-[var(--color-indigo-5)]',
        success:
          'bg-[var(--color-success-bg)] text-[var(--color-success-fg)] border border-[var(--color-success-border)]',
        danger:
          'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)] border border-[var(--color-danger-border)]',
        warning:
          'bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)] border border-[var(--color-warning-border)]',
        info: 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)] border border-[var(--color-info-border)]',
      },
      size: {
        xs: 'h-5 px-1.5 text-[var(--text-h9)] rounded-[var(--radius-xs)]',
        sm: 'h-6 px-2 text-[var(--text-caption)] rounded-[var(--radius-sm)]',
        md: 'h-7 px-2.5 text-[var(--text-body-s)] rounded-[var(--radius-sm)]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface TagProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'onRemove'>,
    VariantProps<typeof tagVariants> {
  onRemove?: () => void;
  removeLabel?: string;
}

const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, variant, size, onRemove, removeLabel = 'Remove', children, ...props }, ref) => (
    <span ref={ref} className={cn(tagVariants({ variant, size }), className)} {...props}>
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="inline-flex items-center justify-center rounded-full p-0.5 hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  ),
);
Tag.displayName = 'Tag';

export { Tag, tagVariants };
export default Tag;
