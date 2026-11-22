import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { createTranslator } from '@repo/i18n';
import { routing } from '@/i18n/routing';
import { StorefrontShell } from '@/components/layout/storefront-shell';

type LayoutParams = { params: Promise<{ locale: string }> };

/** Prerender both locale shells; any other first segment 404s below. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutParams): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = createTranslator(locale);
  return { title: t('meta.title'), description: t('meta.description') };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutParams & { children: ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return <StorefrontShell locale={locale}>{children}</StorefrontShell>;
}
