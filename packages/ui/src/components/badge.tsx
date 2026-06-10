import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 font-semibold leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'bg-[var(--color-slate-3)] text-[var(--color-text-body)]',
        brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-text)]',
        success: 'bg-[var(--color-success-bg)] text-[var(--color-success-fg)]',
        danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]',
        warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]',
        info: 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)]',
        solid: 'bg-[var(--color-danger-solid)] text-[var(--color-text-on-primary)]',
        count:
          'bg-[var(--color-danger-solid)] text-[var(--color-text-on-primary)] min-w-5 justify-center',
      },
      size: {
        sm: 'h-5 px-1.5 text-[10px] rounded-[var(--radius-xs)]',
        md: 'h-6 px-2 text-[var(--text-caption)] rounded-[var(--radius-sm)]',
        lg: 'h-7 px-2.5 text-[var(--text-body-s)] rounded-[var(--radius-sm)]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
export default Badge;
