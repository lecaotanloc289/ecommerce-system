import type { ReactNode } from 'react';
import { Label } from '@repo/ui';

/** Label + control + optional hint / error line. `htmlFor` must match the control's id. */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-caption text-text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-caption text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
