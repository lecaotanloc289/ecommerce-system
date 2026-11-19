'use client';

import * as React from 'react';
import {
  createTranslator,
  DEFAULT_LOCALE,
  isAppLocale,
  type AppLocale,
  type TFunction,
} from '@repo/i18n';

// React glue only — catalogs, key typing and the translator live in @repo/i18n.
export type { MessageKey, TFunction } from '@repo/i18n';

interface LocaleContextValue {
  locale: AppLocale;
  setLocale: (l: AppLocale) => void;
  t: TFunction;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = 'locale';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<AppLocale>(DEFAULT_LOCALE);

  // Hydrate saved choice after mount (avoids SSR/client mismatch).
  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(saved)) setLocaleState(saved);
  }, []);

  const setLocale = React.useCallback((l: AppLocale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  }, []);

  const t = React.useMemo(() => createTranslator(locale), [locale]);

  const value = React.useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = React.useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within <LocaleProvider>');
  return ctx;
}

/** Convenience: just the translate function. */
export function useT(): TFunction {
  return useLocale().t;
}
