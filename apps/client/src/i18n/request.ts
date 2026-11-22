import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * next-intl request config. Only the locale (and a fixed time zone) is resolved here —
 * UI text is translated with `createTranslator` from `@repo/i18n`, so no messages are
 * handed to next-intl.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, timeZone: 'Asia/Ho_Chi_Minh' };
});
