'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex min-h-24 w-full px-3 py-2 text-[var(--text-body-m)]',
        'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]',
        'placeholder:text-[var(--color-text-placeholder)]',
        'border border-[var(--color-border-input)] rounded-[var(--radius-md)]',
        'transition-colors duration-150 resize-y',
        'focus:outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-[var(--color-indigo-3)]',
        'disabled:cursor-not-allowed disabled:bg-[var(--color-bg-muted)] disabled:text-[var(--color-text-disabled)]',
        invalid &&
          'border-[var(--color-danger-solid)] focus:border-[var(--color-danger-solid)] focus:ring-[var(--color-danger-3)]',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
export default Textarea;
