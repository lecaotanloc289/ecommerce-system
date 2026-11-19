'use client';

import { useLocale } from '../../i18n/locale-provider';
import { cn } from '../../lib/utils';
import type { Locale } from '../../types';

const options: { value: Locale; flag: string; label: string }[] = [
  { value: 'vi', flag: '🇻🇳', label: 'VI' },
  { value: 'en', flag: '🇺🇸', label: 'EN' },
];

/** Country-flag language select — flips the in-memory locale (persisted to localStorage). */
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <select
      value={locale}
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'vi' || v === 'en') setLocale(v);
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
