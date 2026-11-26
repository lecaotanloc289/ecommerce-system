import { Facebook } from 'lucide-react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '@repo/ui';
import type { LoginLocationState } from '@/auth/guards';
import { saveReturnPath } from '@/auth/return-path';
import { useAuth } from '@/auth/session';
import { CenteredCard } from '@/components/centered-card';
import { GoogleIcon } from '@/components/google-icon';
import { Splash } from '@/components/splash';
import { env } from '@/env';
import { useT } from '@/i18n/use-locale';

type OAuthProvider = 'google' | 'facebook';

/**
 * OAuth only (Golden Rule #5). The button leaves the SPA for `/v1/auth/<provider>?app=admin`;
 * the API sets the HttpOnly refresh cookie and redirects back to `/auth/callback`.
 */
export function LoginPage() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const location = useLocation();

  if (status === 'restoring') return <Splash />;
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const signIn = (provider: OAuthProvider) => {
    saveReturnPath(readFrom(location.state) ?? '/');
    window.location.assign(`${env.apiUrl}/v1/auth/${provider}?app=admin`);
  };

  return (
    <CenteredCard title={t('admin.login.title')} description={t('admin.login.subtitle')}>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        iconLeft={<GoogleIcon />}
        onClick={() => signIn('google')}
      >
        {t('admin.login.continueGoogle')}
      </Button>
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        iconLeft={<Facebook className="size-5" aria-hidden />}
        onClick={() => signIn('facebook')}
      >
        {t('admin.login.continueFacebook')}
      </Button>
      <p className="text-caption text-text-muted">{t('admin.login.note')}</p>
    </CenteredCard>
  );
}

/** `location.state` is `unknown` (it survives reloads via history) — read `from` defensively. */
function readFrom(state: unknown): LoginLocationState['from'] {
  if (typeof state !== 'object' || state === null || !('from' in state)) return undefined;
  const { from } = state;
  return typeof from === 'string' ? from : undefined;
}
