'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold',
    'transition-colors transition-shadow duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-page)]',
    'disabled:pointer-events-none disabled:opacity-60',
    "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'bg-[var(--color-brand-solid)] text-[var(--color-text-on-primary)]',
          'hover:bg-[var(--color-brand-solid-hover)] active:bg-[var(--color-brand-solid-active)]',
          'shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-cta)]',
          'disabled:bg-[var(--color-brand-disabled)] disabled:shadow-none',
        ].join(' '),
        secondary: [
          'border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]',
          'hover:bg-[var(--color-bg-muted)] hover:border-[var(--color-border-strong)]',
          'active:bg-[var(--color-slate-4)]',
        ].join(' '),
        ghost: [
          'bg-transparent text-[var(--color-brand-text)]',
          'hover:bg-[var(--color-brand-soft)] hover:text-[var(--color-brand-text)]',
          'active:bg-[var(--color-brand-soft-hover)]',
        ].join(' '),
        destructive: [
          'bg-[var(--color-danger-solid)] text-[var(--color-text-on-primary)]',
          'hover:bg-[var(--color-danger-10)] active:bg-[var(--color-danger-11)]',
          'shadow-[var(--shadow-1)]',
        ].join(' '),
        outline: [
          'border border-[var(--color-brand-solid)] bg-transparent text-[var(--color-brand-text)]',
          'hover:bg-[var(--color-brand-soft)]',
        ].join(' '),
        link: [
          'bg-transparent text-[var(--color-text-link)] underline-offset-4',
          'hover:underline hover:text-[var(--color-text-link-hover)]',
          'p-0 h-auto',
        ].join(' '),
        dark: [
          'bg-[var(--color-slate-11)] text-[var(--color-text-on-primary)]',
          'hover:bg-[var(--color-slate-12)] active:bg-[var(--color-slate-12)]',
          'shadow-[var(--shadow-1)]',
        ].join(' '),
      },
      size: {
        sm: 'h-8 px-3 text-[var(--text-body-s)] rounded-[var(--radius-sm)]',
        md: 'h-10 px-4 text-[var(--text-body-m)] rounded-[var(--radius-md)]',
        lg: 'h-12 px-6 text-[var(--text-body-l)] rounded-[var(--radius-md)]',
        xl: 'h-14 px-8 text-[var(--text-body-l)] rounded-[var(--radius-lg)]',
        icon: 'size-10 rounded-[var(--radius-md)]',
      },
      fullWidth: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      asChild = false,
      loading = false,
      disabled,
      iconLeft,
      iconRight,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : iconLeft}
        {children}
        {!loading && iconRight}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
export default Button;
