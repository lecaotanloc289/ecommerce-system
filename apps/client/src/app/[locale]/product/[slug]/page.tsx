import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { ProductDetail } from '@/components/product/product-detail';
import { getProduct } from '@/mocks/products';

/** Rendered on demand per request (no `generateStaticParams`) — slugs will come from the API. */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const product = getProduct(slug);
  if (!product) notFound();
  return <ProductDetail product={product} />;
}
