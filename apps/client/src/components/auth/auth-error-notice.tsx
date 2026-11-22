'use client';

import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@repo/ui';
import { translateError } from '@repo/i18n';
import { useLocale } from '../../i18n/use-locale';

/**
 * Shows the API's `?error=<errorCode>` (e.g. `auth.error.oauth-failed` after a failed OAuth
 * callback) translated through `@repo/i18n`; unknown codes fall back to the generic message.
 * Uses `useSearchParams`, so render it inside a `<Suspense>` on prerendered pages.
 */
export function AuthErrorNotice({ code: forced }: { code?: string | null }) {
  const { locale } = useLocale();
  const params = useSearchParams();
  const code = forced ?? params.get('error');
  if (!code) return null;
  return (
    <Alert variant="danger">
      <AlertCircle aria-hidden />
      <AlertDescription>{translateError(locale, code)}</AlertDescription>
    </Alert>
  );
}
