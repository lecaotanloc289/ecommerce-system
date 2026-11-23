'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Card } from '@repo/ui';
import { useRouter } from '@/i18n/navigation';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { AuthErrorNotice } from '@/components/auth/auth-error-notice';
import { useT } from '@/i18n/use-locale';
import { consumeReturnTo } from '@/lib/return-to';
import { useAuth } from '@/store/auth-provider';

/**
 * OAuth landing page (`AUTH_REDIRECT_URL_WEB`). The API callback has already set the HttpOnly
 * refresh cookie; here we exchange it for an access token (`POST /v1/auth/refresh`, shared
 * with the provider's mount-time restore — single-flight), load `GET /v1/auth/me` and go back
 * to the saved `returnTo`. `?error=<code>` (failed OAuth) is shown instead.
 */
export default function AuthCallbackPage() {
  return (
    <Container as="section" className="flex justify-center py-16 lg:py-24">
      <Card className="flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
        <React.Suspense fallback={<Pending />}>
          <Callback />
        </React.Suspense>
      </Card>
    </Container>
  );
}

function Pending() {
  const t = useT();
  return (
    <p role="status" className="flex items-center gap-2 text-body-m text-text-muted">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {t('auth.callbackPending')}
    </p>
  );
}

function Callback() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { restore } = useAuth();
  const error = params.get('error');
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (error) return;
    let cancelled = false;
    void restore().then((state) => {
      if (cancelled) return;
      if (state.status === 'authenticated') router.replace(consumeReturnTo());
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [error, restore, router]);

  if (!error && !failed) return <Pending />;

  return (
    <>
      <h1 className="font-heading text-h5 font-bold text-text-primary">
        {t('auth.callbackFailed')}
      </h1>
      <div className="w-full text-left">
        <AuthErrorNotice code={error ?? 'auth.error.oauth-failed'} />
      </div>
      <ButtonLink href="/sign-in" size="md">
        {t('auth.tryAgain')}
      </ButtonLink>
    </>
  );
}
