import type { Metadata } from 'next';
import { ChevronRight } from 'lucide-react';
import { createTranslator } from '@repo/i18n';
import { Link, redirect } from '@/i18n/navigation';
import { pageLocale } from '@/i18n/page-locale';
import { Container } from '@/components/layout/container';
import { Breadcrumb } from '@/components/common/breadcrumb';
import { CATALOG_PAGE_SIZE, CatalogListing } from '@/components/product/catalog-listing';
import { getCategory, getPublicSettings, listProducts } from '@/lib/api/server';
import {
  catalogFiltersToQuery,
  parseCatalogFilters,
  type SearchParamsRecord,
} from '@/lib/catalog-query';
import { catalogMetadata } from '@/lib/metadata';

// Catalog data is read per request (no ISR with OpenNext's read-only cache — see lib/api/server.ts).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale(params);
  const { slug } = await params;
  const category = await getCategory(slug, locale);
  const t = createTranslator(locale);
  return catalogMetadata({
    title: `${category.name} | ${t('common.brand')}`,
    description: t('catalog.categoryDescription', { name: category.name }),
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const locale = await pageLocale(params);
  const { slug } = await params;
  const t = createTranslator(locale);
  const [category, settings, query] = await Promise.all([
    getCategory(slug, locale),
    getPublicSettings(),
    searchParams,
  ]);
  const currency = settings.defaultCurrency;
  const filters = parseCatalogFilters(query, currency);

  // `/categories/:slug` accepts either language's slug; keep the URL in the page's language.
  if (category.slug !== slug) {
    const qs = new URLSearchParams(catalogFiltersToQuery(filters, currency)).toString();
    redirect({ href: `/categories/${category.slug}${qs ? `?${qs}` : ''}`, locale });
  }

  const page = await listProducts({
    locale,
    categorySlug: category.slug,
    limit: CATALOG_PAGE_SIZE,
    ...filters,
  });

  const subcategories =
    category.children.length > 0 ? (
      <nav aria-label={t('catalog.subcategories')} className="flex flex-col">
        <p className="mb-2 text-body-m font-semibold text-text-primary">
          {t('catalog.subcategories')}
        </p>
        <ul className="flex flex-col">
          {category.children.map((child) => (
            <li key={child.id}>
              <Link
                href={`/categories/${child.slug}`}
                className="flex items-center gap-2 border-t border-border-subtle py-2.5 text-body-m text-text-body transition-colors hover:text-brand-text"
              >
                <ChevronRight className="size-4 text-text-muted" aria-hidden />
                {child.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    ) : null;

  return (
    <Container as="section" className="py-8 lg:py-12">
      <Breadcrumb
        label={t('catalog.breadcrumb')}
        className="mb-2"
        items={[
          { label: t('common.home'), href: '/' },
          { label: t('nav.categories'), href: '/categories' },
          ...category.breadcrumb.map((c) =>
            c.id === category.id
              ? { label: c.name }
              : { label: c.name, href: `/categories/${c.slug}` },
          ),
        ]}
      />
      <h1 className="mb-8 font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {category.name}
      </h1>
      <CatalogListing
        page={page}
        filters={filters}
        currency={currency}
        feed={{ kind: 'products', locale, categorySlug: category.slug, filters }}
        sidebar={subcategories}
      />
    </Container>
  );
}
