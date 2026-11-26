import type { ReactNode } from 'react';

/** Title row at the top of every portal page; `actions` sit on the right (stack on mobile). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-h6 font-bold text-text-primary sm:text-h5">{title}</h1>
        {description ? <p className="text-body-s text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
