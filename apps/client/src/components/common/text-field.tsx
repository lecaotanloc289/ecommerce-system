'use client';

import * as React from 'react';
import { Input, Label } from '@repo/ui';
import type { FieldErrorKey } from '@/lib/form-errors';
import { useT } from '@/i18n/use-locale';
import { cn } from '@/lib/utils';

/** Label + input + translated error, wired with `aria-invalid` / `aria-describedby`. */
export function TextField({
  name,
  label,
  error,
  className,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, 'name' | 'invalid'> & {
  name: string;
  label: string;
  error?: FieldErrorKey | undefined;
}) {
  const t = useT();
  const id = React.useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        invalid={error !== undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-body-s text-danger-fg">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
