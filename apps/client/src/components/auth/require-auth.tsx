'use client';

import * as React from 'react';
import { LogIn } from 'lucide-react';
import { Card } from '@repo/ui';
import { Container } from '../layout/container';
import { ButtonLink } from '../common/button-link';
import { usePathname } from '@/i18n/navigation';
import { useT, type MessageKey } from '../../i18n/use-locale';
import { useAuth } from '../../store/auth-provider';

/** Path + query of the current page (client only), for `?returnTo=`. */
export function useCurrentPath(): string {
  const pathname = usePathname();
  const [search, setSearch] = React.useState('');
  React.useEffect(() => setSearch(window.location.search), [pathname]);
  return `${pathname}${search}`;
}

/** `/sign-in?returnTo=<current page>` — the OAuth callback brings the customer back here. */
export function useSignInHref(): string {
  const current = useCurrentPath();
  return `/sign-in?${new URLSearchParams({ returnTo: current }).toString()}`;
}

/**
 * Renders `children` for a signed-in customer, a loading hint while the session is being
 * restored, and a sign-in prompt (returning to this page) for guests.
 */
export function RequireAuth({
  title,
  body,
  children,
}: {
  title: MessageKey;
  body?: MessageKey;
  children: React.ReactNode;
}) {
  const t = useT();
  const { status } = useAuth();
  const href = useSignInHref();

  if (status === 'authenticated') return <>{children}</>;
  if (status === 'loading') {
    return (
      <Container as="section" className="py-16 text-center text-body-m text-text-muted">
        <p role="status">{t('common.loading')}</p>
      </Container>
    );
  }
  return (
    <Container as="section" className="flex justify-center py-16">
      <Card className="flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-text">
          <LogIn className="size-7" aria-hidden />
        </span>
        <h1 className="font-heading text-h5 font-semibold text-text-primary">{t(title)}</h1>
        {body ? <p className="text-body-m text-text-muted">{t(body)}</p> : null}
        <ButtonLink href={href} size="lg">
          {t('auth.signIn')}
        </ButtonLink>
      </Card>
    </Container>
  );
}
