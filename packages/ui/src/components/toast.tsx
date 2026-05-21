'use client';

import * as React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

const Toaster = (props: ToasterProps) => (
  <SonnerToaster
    position="top-right"
    toastOptions={{
      classNames: {
        toast:
          'group toast group-[.toaster]:bg-[var(--color-bg-elevated)] group-[.toaster]:text-[var(--color-text-primary)] group-[.toaster]:border-[var(--color-border-subtle)] group-[.toaster]:shadow-[var(--shadow-3)] group-[.toaster]:rounded-[var(--radius-md)]',
        description: 'group-[.toast]:text-[var(--color-text-muted)]',
        actionButton:
          'group-[.toast]:bg-[var(--color-brand-solid)] group-[.toast]:text-[var(--color-text-on-primary)]',
        cancelButton:
          'group-[.toast]:bg-[var(--color-bg-muted)] group-[.toast]:text-[var(--color-text-primary)]',
        success: 'group-[.toaster]:border-[var(--color-success-border)]',
        error: 'group-[.toaster]:border-[var(--color-danger-border)]',
        warning: 'group-[.toaster]:border-[var(--color-warning-border)]',
        info: 'group-[.toaster]:border-[var(--color-info-border)]',
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
