'use client';

import { useTransition } from 'react';
import { isAppLocale, type AppLocale } from '@repo/i18n';
import { useLocale } from '@/i18n/use-locale';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '../../lib/utils';

const options: { value: AppLocale; flag: string; label: string }[] = [
  { value: 'vi', flag: '🇻🇳', label: 'VI' },
  { value: 'en', flag: '🇺🇸', label: 'EN' },
];

/**
 * Country-flag language select — navigates to the same page under the other locale prefix
 * (`/vi/cart?x=1` → `/en/cart?x=1`). next-intl remembers the choice in the `NEXT_LOCALE` cookie.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={locale}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        if (!isAppLocale(next) || next === locale) return;
        // Read the query at event time: `useSearchParams` would force a Suspense boundary
        // around the navbar (it lives in the layout).
        const href = `${pathname}${window.location.search}${window.location.hash}`;
        startTransition(() => router.replace(href, { locale: next }));
      }}
      aria-label={t('common.selectLanguage')}
      className={cn(
        'h-9 cursor-pointer rounded-md bg-transparent px-2 text-body-s font-medium text-text-body',
        'transition-colors hover:bg-bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.flag} {o.label}
        </option>
      ))}
    </select>
  );
}
