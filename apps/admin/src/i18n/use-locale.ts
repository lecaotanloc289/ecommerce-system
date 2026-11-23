import { useMemo } from 'react';
import { create } from 'zustand';
import {
  createTranslator,
  DEFAULT_LOCALE,
  isAppLocale,
  type AppLocale,
  type TFunction,
} from '@repo/i18n';

// React glue only — catalogs, key typing and the translator live in @repo/i18n.
// The locale preference is not sensitive, so it is remembered in localStorage (an SPA has no
// server to read a cookie and no locale URL segment); the access token never is.
export type { MessageKey, TFunction } from '@repo/i18n';

const STORAGE_KEY = 'admin.locale';

function readStoredLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isAppLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

interface LocaleState {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
}

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: readStoredLocale(),
  setLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage blocked: the choice lasts for this tab only.
    }
    set({ locale });
  },
}));

/** Current locale, its translator and the setter used by the locale switcher. */
export function useLocale(): {
  locale: AppLocale;
  t: TFunction;
  setLocale: (l: AppLocale) => void;
} {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  return { locale, t, setLocale };
}

/** Convenience: just the translate function. */
export function useT(): TFunction {
  return useLocale().t;
}
