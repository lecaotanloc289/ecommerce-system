import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const alertVariants = cva(
  [
    'relative w-full border rounded-[var(--radius-md)] p-4',
    'grid grid-cols-[auto_1fr] gap-x-3 gap-y-1',
    '[&>svg]:size-5 [&>svg]:translate-y-0.5',
  ].join(' '),
  {
    variants: {
      variant: {
        info: 'bg-[var(--color-info-bg)] text-[var(--color-info-fg)] border-[var(--color-info-border)] [&>svg]:text-[var(--color-info-solid)]',
        success:
          'bg-[var(--color-success-bg)] text-[var(--color-success-fg)] border-[var(--color-success-border)] [&>svg]:text-[var(--color-success-solid)]',
        warning:
          'bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)] border-[var(--color-warning-border)] [&>svg]:text-[var(--color-warning-solid)]',
        danger:
          'bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)] border-[var(--color-danger-border)] [&>svg]:text-[var(--color-danger-solid)]',
        neutral:
          'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] border-[var(--color-border-default)] [&>svg]:text-[var(--color-text-muted)]',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn(
        'col-start-2 font-semibold text-[var(--text-body-m)] leading-none tracking-tight',
        className,
      )}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'col-start-2 text-[var(--text-body-s)] leading-[var(--leading-body-s)]',
      className,
    )}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
export default Alert;
