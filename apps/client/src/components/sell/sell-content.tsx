'use client';

import * as React from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from '@repo/ui';
import type { VendorApplication } from '@repo/core';
import { formatDate } from '@repo/i18n';
import { getMyVendorApplications } from '@/lib/api/account';
import { vendorPortalUrl } from '@/lib/api/config';
import { applicationView, canApply, type ApplicationView } from '@/lib/vendor-application';
import { Link } from '@/i18n/navigation';
import { useLocale, type MessageKey } from '@/i18n/use-locale';
import { useAuth } from '@/store/auth-provider';
import { Container } from '../layout/container';
import { ButtonLink } from '../common/button-link';
import { VendorApplicationForm } from './vendor-application-form';

const STATUS_LABEL: Record<VendorApplication['status'], MessageKey> = {
  PENDING: 'sell.statusPending',
  APPROVED: 'sell.statusApproved',
  REJECTED: 'sell.statusRejected',
};
const STATUS_BADGE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' } as const;

/** `/sell`: pitch + (signed in) the application form or the current application status. */
export function SellContent() {
  const { t } = useLocale();
  const { status, user } = useAuth();
  const authenticated = status === 'authenticated' && user !== null;

  return (
    <Container as="section" className="py-10 lg:py-14">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="font-heading text-h3 font-bold tracking-tight text-text-primary">
            {t('sell.title')}
          </h1>
          <p className="text-body-l text-text-body">{t('sell.intro')}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-body-m text-text-body">
            <li>{t('sell.benefitReach')}</li>
            <li>{t('sell.benefitPayout')}</li>
            <li>{t('sell.benefitTools')}</li>
          </ul>
        </header>

        {status === 'loading' ? (
          <p role="status" aria-busy className="text-body-m text-text-muted">
            {t('common.loading')}
          </p>
        ) : authenticated ? (
          <Application hasVendor={user.vendorId !== null} />
        ) : (
          <Card className="flex flex-col items-start gap-3 p-6">
            <h2 className="text-h6 font-semibold text-text-primary">{t('sell.signInTitle')}</h2>
            <p className="text-body-m text-text-body">{t('sell.signInBody')}</p>
            <ButtonLink href={`/sign-in?${new URLSearchParams({ returnTo: '/sell' }).toString()}`}>
              {t('auth.signIn')}
            </ButtonLink>
          </Card>
        )}
      </div>
    </Container>
  );
}

function Application({ hasVendor }: { hasVendor: boolean }) {
  const { locale, t } = useLocale();
  const { user, reload } = useAuth();
  const [view, setView] = React.useState<ApplicationView | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [reapplying, setReapplying] = React.useState(false);
  const [refreshFailed, setRefreshFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoadError(false);
    try {
      setView(applicationView(await getMyVendorApplications()));
      setReapplying(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Approved: the vendor role only appears in the token after a refresh (roles are re-read there).
  const approved = view?.kind === 'approved';
  const hasVendorRole = user?.vendorId != null;
  React.useEffect(() => {
    if (!approved || hasVendorRole) return;
    let cancelled = false;
    void reload().then((state) => {
      if (!cancelled && state.user?.vendorId == null) setRefreshFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [approved, hasVendorRole, reload]);

  if (loadError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {t('sell.loadFailed')}{' '}
          <Button variant="link" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!view) {
    return (
      <p role="status" aria-busy className="text-body-m text-text-muted">
        {t('common.loading')}
      </p>
    );
  }

  const portal = vendorPortalUrl();
  const latest = view.kind === 'none' ? null : view.application;
  const showForm = !hasVendor && (reapplying || view.kind === 'none');

  return (
    <div className="flex flex-col gap-8">
      {latest ? (
        <Card className="flex flex-col gap-3 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-h6 font-semibold text-text-primary">{t('sell.statusTitle')}</h2>
            <Badge variant={STATUS_BADGE[latest.status]}>{t(STATUS_LABEL[latest.status])}</Badge>
          </div>
          <p className="text-body-s text-text-muted">
            {t('sell.submittedOn', { date: formatDate(latest.createdAt, locale) })}
          </p>
          {view.kind === 'pending' ? (
            <p className="text-body-m text-text-body">{t('sell.pendingBody')}</p>
          ) : null}
          {view.kind === 'approved' ? (
            <>
              <p className="text-body-m text-text-body">{t('sell.approvedBody')}</p>
              {refreshFailed && !hasVendorRole ? (
                <Alert variant="warning">
                  <AlertDescription>{t('sell.portalRefreshFailed')}</AlertDescription>
                </Alert>
              ) : null}
              {portal ? (
                <div>
                  {/* Another origin (the admin app): a plain anchor, not the locale-aware Link. */}
                  <a
                    href={portal}
                    className="inline-flex h-10 items-center rounded-md bg-brand-solid px-4 text-body-m font-semibold text-text-on-primary hover:bg-brand-solid-hover"
                  >
                    {t('sell.portalLink')}
                  </a>
                </div>
              ) : null}
            </>
          ) : null}
          {view.kind === 'rejected' ? (
            <>
              <Alert variant="danger">
                <AlertTitle>{t('sell.statusRejected')}</AlertTitle>
                <AlertDescription>
                  <p>{t('sell.rejectedBody')}</p>
                  {latest.rejectReason ? (
                    <p className="mt-1">
                      <span className="font-semibold">{t('sell.rejectReason')}: </span>
                      {latest.rejectReason}
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
              {canApply(view) && !reapplying && !hasVendor ? (
                <div>
                  <Button onClick={() => setReapplying(true)}>{t('sell.reapply')}</Button>
                </div>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {hasVendor && !latest ? (
        <Alert variant="info">
          <AlertDescription>{t('sell.alreadyVendor')}</AlertDescription>
        </Alert>
      ) : null}

      {showForm ? (
        <Card className="flex flex-col gap-5 p-6">
          <h2 className="text-h6 font-semibold text-text-primary">{t('sell.formTitle')}</h2>
          <VendorApplicationForm onSubmitted={() => void load()} />
        </Card>
      ) : null}

      {view.history.length > 0 ? (
        <section aria-labelledby="sell-history" className="flex flex-col gap-3">
          <h2 id="sell-history" className="text-body-l font-semibold text-text-primary">
            {t('sell.historyTitle')}
          </h2>
          <ul className="flex flex-col divide-y divide-border-faint">
            {view.history.map((application) => (
              <li key={application.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-center gap-3">
                  <Badge variant={STATUS_BADGE[application.status]}>
                    {t(STATUS_LABEL[application.status])}
                  </Badge>
                  <span className="text-body-s text-text-muted">
                    {t('sell.submittedOn', { date: formatDate(application.createdAt, locale) })}
                  </span>
                </div>
                {application.rejectReason ? (
                  <p className="text-body-s text-text-body">{application.rejectReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-body-s text-text-muted">
        <Link href="/account" className="text-brand-text hover:underline">
          {t('account.title')}
        </Link>
      </p>
    </div>
  );
}
