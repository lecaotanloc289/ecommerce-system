'use client';

import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

/** −/value/+ quantity control. Controlled or uncontrolled. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
}: {
  value?: number;
  onChange?: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [internal, setInternal] = React.useState(value ?? min);
  const current = value ?? internal;

  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (value === undefined) setInternal(clamped);
    onChange?.(clamped);
  };

  const btn =
    'inline-flex size-9 items-center justify-center text-text-body transition-colors hover:bg-bg-muted disabled:cursor-not-allowed disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border-default bg-bg-elevated',
        className,
      )}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        className={btn}
        onClick={() => set(current - 1)}
        disabled={current <= min}
      >
        <Minus className="size-4" />
      </button>
      <span
        className="w-9 text-center text-body-m font-medium tabular-nums text-text-primary"
        aria-live="polite"
      >
        {current}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        className={btn}
        onClick={() => set(current + 1)}
        disabled={current >= max}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
