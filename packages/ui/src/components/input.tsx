'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const inputVariants = cva(
  [
    'flex w-full bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]',
    'placeholder:text-[var(--color-text-placeholder)]',
    'border border-[var(--color-border-input)]',
    'transition-colors duration-150',
    'focus:outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-indigo-3)] focus:ring-offset-0',
    'disabled:cursor-not-allowed disabled:bg-[var(--color-bg-muted)] disabled:text-[var(--color-text-disabled)]',
    'file:border-0 file:bg-transparent file:text-sm file:font-medium',
  ].join(' '),
  {
    variants: {
      size: {
        sm: 'h-8 px-3 text-[var(--text-body-s)] rounded-[var(--radius-sm)]',
        md: 'h-10 px-3 text-[var(--text-body-m)] rounded-[var(--radius-md)]',
        lg: 'h-12 px-4 text-[var(--text-body-l)] rounded-[var(--radius-md)]',
      },
      invalid: {
        true: 'border-[var(--color-danger-solid)] focus:border-[var(--color-danger-solid)] focus:ring-[var(--color-danger-3)]',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', size, invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(inputVariants({ size, invalid }), className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input, inputVariants };
export default Input;
