import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { translateError } from '@repo/i18n';
import { Button, buttonVariants } from '@repo/ui';
import { clearReturnPath, readReturnPath } from '@/auth/return-path';
import { authStore, useAuth } from '@/auth/session';
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
  const signedIn = !errorCode && status === 'authenticated';

  useEffect(() => {
    if (signedIn) clearReturnPath();
  }, [signedIn]);

  if (!errorCode && status === 'restoring') return <Splash messageKey="admin.callback.signingIn" />;
  if (signedIn) return <Navigate to={returnPath} replace />;

  if (!errorCode && status === 'error') {
    // API unreachable / 5xx: the cookie the API just set is probably fine — retry, don't re-login.
    return (
      <CenteredCard title={t('admin.callback.failedTitle')} description={t('admin.error.network')}>
        <Button fullWidth onClick={() => void authStore.getState().restoreSession()}>
          {t('admin.error.retry')}
        </Button>
      </CenteredCard>
    );
  }

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
