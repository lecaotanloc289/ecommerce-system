'use client';

import * as React from 'react';
import type { Locale } from '../types';
import { en, type Messages } from './messages/en';
import { vi } from './messages/vi';

const catalogues: Record<Locale, Messages> = { en, vi };

/** Union of every dot-path leaf key in the message tree, e.g. "nav.home". */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown> ? `${K}.${DotPaths<T[K]>}` : K;
}[keyof T & string];

export type MessageKey = DotPaths<Messages>;

type Params = Record<string, string | number>;

export type TFunction = (key: MessageKey, params?: Params) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
}

const LocaleContext = React.createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = 'locale';
const DEFAULT_LOCALE: Locale = 'vi';

function resolve(messages: Messages, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages);
  return typeof value === 'string' ? value : key;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(DEFAULT_LOCALE);

  // Hydrate saved choice after mount (avoids SSR/client mismatch).
  React.useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'vi' || saved === 'en') setLocaleState(saved);
  }, []);

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  }, []);

  const t = React.useCallback<TFunction>(
    (key, params) => interpolate(resolve(catalogues[locale], key), params),
    [locale],
  );

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
