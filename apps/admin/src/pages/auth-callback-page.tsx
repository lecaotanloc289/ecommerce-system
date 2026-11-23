import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { translateError } from '@repo/i18n';
import { buttonVariants } from '@repo/ui';
import { readReturnPath } from '@/auth/return-path';
import { useAuth } from '@/auth/session';
import { CenteredCard } from '@/components/centered-card';
import { Splash } from '@/components/splash';
import { useLocale } from '@/i18n/use-locale';

/**
 * OAuth landing page. The API has already set the refresh cookie; the boot `restoreSession()`
 * (started in `main.tsx`) exchanges it for the in-memory access token. On failure the API appends
 * `?error=<errorCode>`.
 */
export function AuthCallbackPage() {
  const { locale, t } = useLocale();
  const [params] = useSearchParams();
  const status = useAuth((s) => s.status);
  const [returnPath] = useState(readReturnPath);
  const errorCode = params.get('error');

  if (!errorCode && status === 'restoring') return <Splash messageKey="admin.callback.signingIn" />;
  if (!errorCode && status === 'authenticated') return <Navigate to={returnPath} replace />;

  const description = errorCode
    ? translateError(locale, errorCode)
    : t('admin.callback.failedSession');
  return (
    <CenteredCard title={t('admin.callback.failedTitle')} description={description}>
      <Link to="/login" replace className={buttonVariants({ fullWidth: true })}>
        {t('admin.callback.backToLogin')}
      </Link>
    </CenteredCard>
  );
}
