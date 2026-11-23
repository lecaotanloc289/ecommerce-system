import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { VendorInvitationAcceptResultSchema, VendorInvitationAcceptSchema } from '@repo/core';
import { Alert, AlertDescription, Button, buttonVariants } from '@repo/ui';
import type { LoginLocationState } from '@/auth/guards';
import { authStore, api, useAuth } from '@/auth/session';
import { CenteredCard } from '@/components/centered-card';
import { ErrorAlert } from '@/components/error-alert';
import { Splash } from '@/components/splash';
import { useT } from '@/i18n/use-locale';
import { ApiError, unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';

/**
 * `/invite?token=…` — accept a shop staff invitation (public route, the link is emailed).
 *
 * Signed out → `/login` (the deep link, token included, is kept for the OAuth round-trip).
 * Signed in → "Accept" → `POST /v1/vendor-invitations/accept` → the new role only shows in the
 * next access token, so refresh the session (`/auth/refresh` + `/auth/me`) → `/vendor`.
 * The token is never logged or stored beyond that return path (sessionStorage, same tab, removed
 * once the callback lands).
 */
export function InvitePage() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = useAuth((s) => s.status);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const parsed = VendorInvitationAcceptSchema.safeParse({ token: params.get('token') ?? '' });

  const accept = useApiMutation(
    async (token: string, headers) => {
      const result = await unwrap(
        api.POST('/v1/vendor-invitations/accept', { params: { header: headers }, body: { token } }),
      );
      VendorInvitationAcceptResultSchema.parse(result);
      await authStore.getState().restoreSession();
      return authStore.getState().status;
    },
    {
      onSuccess: (sessionStatus) => {
        if (sessionStatus === 'authenticated') void navigate('/vendor', { replace: true });
        else setRefreshFailed(true);
      },
    },
  );

  if (!parsed.success) {
    return (
      <CenteredCard title={t('admin.invite.title')} description={t('admin.invite.missingToken')}>
        <Link to="/" className={buttonVariants({ variant: 'secondary', fullWidth: true })}>
          {t('admin.notFound.backHome')}
        </Link>
      </CenteredCard>
    );
  }

  if (status === 'restoring' && !accept.isPending) return <Splash />;
  if (status === 'anonymous') {
    const state: LoginLocationState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }

  if (refreshFailed) {
    // Accepted, but the session refresh failed (offline / 5xx): signing in again picks the role up.
    return (
      <CenteredCard title={t('admin.invite.title')} description={t('admin.invite.refreshFailed')}>
        <Button
          fullWidth
          onClick={() => {
            setRefreshFailed(false);
            void authStore
              .getState()
              .restoreSession()
              .then(() => {
                if (authStore.getState().status === 'authenticated') {
                  void navigate('/vendor', { replace: true });
                } else setRefreshFailed(true);
              });
          }}
        >
          {t('admin.error.retry')}
        </Button>
      </CenteredCard>
    );
  }

  const error = accept.error;
  const conflict = error instanceof ApiError && error.errorCode === 'common.error.conflict';
  const token = parsed.data.token;

  return (
    <CenteredCard title={t('admin.invite.title')} description={t('admin.invite.description')}>
      {error && !conflict ? <ErrorAlert error={error} /> : null}
      {conflict ? (
        // 409: the account already belongs to a shop (one shop per account) — more useful than
        // the generic "changed in the meantime".
        <Alert variant="danger">
          <AlertDescription>{t('admin.invite.conflict')}</AlertDescription>
        </Alert>
      ) : null}
      <Button fullWidth size="lg" loading={accept.isPending} onClick={() => accept.mutate(token)}>
        {t('admin.invite.accept')}
      </Button>
    </CenteredCard>
  );
}
