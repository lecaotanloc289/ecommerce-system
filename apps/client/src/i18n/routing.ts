import { defineRouting } from 'next-intl/routing';
import { APP_LOCALES, DEFAULT_LOCALE } from '@repo/i18n';

/**
 * Locale routing (next-intl): every page lives under `/vi/...` or `/en/...`.
 * A bare path (`/`, `/cart`) is redirected by the middleware to the visitor's locale:
 * `NEXT_LOCALE` cookie → `Accept-Language` → `vi`.
 */
export const routing = defineRouting({
  locales: APP_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});
