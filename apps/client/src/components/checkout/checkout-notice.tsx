'use client';

import { AlertCircle, X } from 'lucide-react';
import { translateError } from '@repo/i18n';
import { useLocale } from '../../i18n/use-locale';
import { useCheckout } from '../../store/checkout-store';

/** The API error that sent the customer back to this step (cleared once dismissed). */
export function CheckoutNotice({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const { notice, setNotice } = useCheckout();
  if (!notice) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border border-danger-border bg-danger-bg p-4 text-danger-fg ${className ?? ''}`}
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p className="flex-1 text-body-m">
        {translateError(locale, notice.errorCode, notice.params)}
      </p>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label={t('common.close')}
        className="inline-flex size-6 items-center justify-center rounded-md hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
