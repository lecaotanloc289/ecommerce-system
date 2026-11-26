'use client';

import * as React from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useT } from '@/i18n/use-locale';
import { useAuth } from '@/store/auth-provider';

/**
 * Renders `children` once the session is restored and signed in. A visitor without a session is
 * sent to `/sign-in?returnTo=<this path>` (the OAuth round-trip brings them back). The access
 * token is only in memory, so the page can't tell "signed out" until `restore()` finishes.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (status !== 'anonymous') return;
    const search = window.location.search;
    const returnTo = new URLSearchParams({ returnTo: `${pathname}${search}` });
    router.replace(`/sign-in?${returnTo.toString()}`);
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <p role="status" aria-busy className="py-10 text-body-m text-text-muted">
        {status === 'anonymous' ? t('account.redirecting') : t('common.loading')}
      </p>
    );
  }
  return <>{children}</>;
}
