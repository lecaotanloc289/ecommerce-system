'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '../lib/cn';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex size-4 shrink-0 items-center justify-center',
      'border border-[var(--color-border-strong)] rounded-[var(--radius-xs)]',
      'bg-[var(--color-bg-elevated)] transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[var(--color-brand-solid)] data-[state=checked]:border-[var(--color-brand-solid)] data-[state=checked]:text-[var(--color-text-on-primary)]',
      'data-[state=indeterminate]:bg-[var(--color-brand-solid)] data-[state=indeterminate]:border-[var(--color-brand-solid)] data-[state=indeterminate]:text-[var(--color-text-on-primary)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === 'indeterminate' ? (
        <Minus className="size-3" aria-hidden />
      ) : (
        <Check className="size-3" aria-hidden />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
export default Checkbox;
