'use client';

import * as React from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { useT, type MessageKey } from '@/i18n/use-locale';
import { cn } from '@/lib/utils';
import { Container } from '../layout/container';
import { RequireAuth } from './require-auth';

const NAV: readonly { href: string; label: MessageKey }[] = [
  { href: '/account', label: 'account.profile' },
  { href: '/account/addresses', label: 'account.addresses' },
  // Built by T5.1.
  { href: '/account/orders', label: 'account.orders' },
  { href: '/sell', label: 'account.sell' },
];

/** Signed-in area frame: heading, section nav, and the sign-in redirect for guests. */
export function AccountShell({
  title,
  children,
}: {
  title: MessageKey;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  return (
    <Container as="section" className="py-10 lg:py-14">
      <RequireAuth>
        <h1 className="mb-6 font-heading text-h4 font-bold tracking-tight text-text-primary">
          {t(title)}
        </h1>
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <nav aria-label={t('account.navLabel')}>
            <ul className="flex gap-2 overflow-x-auto lg:flex-col">
              {NAV.map(({ href, label }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'block whitespace-nowrap rounded-md px-3 py-2 text-body-m transition-colors hover:bg-bg-muted',
                        active ? 'bg-brand-soft font-semibold text-brand-text' : 'text-text-body',
                      )}
                    >
                      {t(label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0">{children}</div>
        </div>
      </RequireAuth>
    </Container>
  );
}
