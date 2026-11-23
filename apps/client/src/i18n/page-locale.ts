import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { AppLocale } from '@repo/i18n';
import { routing } from './routing';

/**
 * Page/layout prologue for `[locale]` routes: validate the segment (unknown → 404) and register
 * it for next-intl's server APIs. Returns the typed locale.
 */
export async function pageLocale(params: Promise<{ locale: string }>): Promise<AppLocale> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return locale;
}
