'use client';

import { useMemo } from 'react';
import { useLocale as useRouteLocale } from 'next-intl';
import { createTranslator, type AppLocale, type TFunction } from '@repo/i18n';

// Client glue only — the locale comes from the URL segment (`/vi`, `/en`) via next-intl;
// catalogs, key typing and the translator live in @repo/i18n.
export type { MessageKey, TFunction } from '@repo/i18n';

/** Current route locale + its translator. Switch locale with `LocaleToggle` (URL change). */
export function useLocale(): { locale: AppLocale; t: TFunction } {
  const locale = useRouteLocale();
  const t = useMemo(() => createTranslator(locale), [locale]);
  return { locale, t };
}

/** Convenience: just the translate function. */
export function useT(): TFunction {
  return useLocale().t;
}
