'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@repo/ui';
import { Link, usePathname } from '@/i18n/navigation';
import { useT, type MessageKey } from '../../i18n/use-locale';
import { useAuth } from '../../store/auth-provider';

/** Signed-in shortcuts (`/account/orders` is built by T5.1). */
const ACCOUNT_LINKS: readonly { href: string; label: MessageKey }[] = [
  { href: '/account', label: 'account.profile' },
  { href: '/account/orders', label: 'account.orders' },
  { href: '/sell', label: 'account.sell' },
];

const triggerClass =
  'ml-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-text-body transition-colors hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus';

/**
 * Navbar account slot: a sign-in link (remembering the current page + query as `returnTo`)
 * for guests, the user's name + a sign-out popover once the session is restored.
 * `useSearchParams` needs a Suspense boundary on prerendered pages; the fallback is the same
 * link without the query.
 */
export function UserMenu() {
  return (
    <React.Suspense fallback={<AccountSlot search="" />}>
      <AccountSlotWithQuery />
    </React.Suspense>
  );
}

function AccountSlotWithQuery() {
  return <AccountSlot search={useSearchParams().toString()} />;
}

function AccountSlot({ search }: { search: string }) {
  const t = useT();
  const pathname = usePathname();
  const { status, user, signOut } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  if (status !== 'authenticated' || !user) {
    const returnTo = new URLSearchParams({ returnTo: search ? `${pathname}?${search}` : pathname });
    return (
      <Link
        href={`/sign-in?${returnTo.toString()}`}
        aria-busy={status === 'loading'}
        className={triggerClass}
      >
        <User className="size-5" aria-hidden />
        <span className="hidden text-left lg:block">
          <span className="block text-[11px] leading-3 text-text-muted">{t('auth.account')}</span>
          <span className="block text-body-s font-semibold text-text-primary">
            {t('auth.signIn')}
          </span>
        </span>
        <span className="sr-only lg:hidden">{t('auth.signIn')}</span>
      </Link>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setFailed(false);
      }}
    >
      <PopoverTrigger
        className={triggerClass}
        aria-label={t('auth.accountMenu', { name: user.name })}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
        ) : (
          <User className="size-5" aria-hidden />
        )}
        <span className="hidden max-w-32 text-left lg:block">
          <span className="block text-[11px] leading-3 text-text-muted">{t('auth.account')}</span>
          <span className="block truncate text-body-s font-semibold text-text-primary">
            {user.name}
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="text-body-s text-text-muted">{t('auth.signedInAs')}</p>
        <p className="truncate text-body-m font-semibold text-text-primary">{user.name}</p>
        {user.email ? <p className="truncate text-body-s text-text-muted">{user.email}</p> : null}
        <nav
          aria-label={t('account.navLabel')}
          className="mt-3 flex flex-col border-t border-border-faint pt-2"
        >
          {ACCOUNT_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1.5 text-body-m text-text-body hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              {t(label)}
            </Link>
          ))}
        </nav>
        <Button
          variant="secondary"
          size="md"
          fullWidth
          className="mt-3"
          disabled={busy}
          iconLeft={<LogOut className="size-4" />}
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              setFailed(!(await signOut()));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('auth.signOut')}
        </Button>
        {failed ? (
          <p role="alert" className="mt-2 text-body-s text-danger-fg">
            {t('auth.signOutFailed')}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
