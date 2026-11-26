import type { CatalogLocale, Locale } from '@repo/core';

/** `?locale=vi|en` → DB enum value. */
export function toDbLocale(locale: CatalogLocale): Locale {
  return locale === 'en' ? 'EN' : 'VI';
}

/**
 * Picks the translation for the requested locale, falling back to vi, then to any row
 * (a product/category always has at least one translation, but never assume both).
 */
export function pickTranslation<T extends { locale: Locale }>(
  translations: readonly T[],
  locale: CatalogLocale,
): T | undefined {
  const wanted = toDbLocale(locale);
  return (
    translations.find((t) => t.locale === wanted) ??
    translations.find((t) => t.locale === 'VI') ??
    translations[0]
  );
}
