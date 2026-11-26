import type { Metadata } from 'next';
import { createTranslator, type AppLocale } from '@repo/i18n';
import { pageLocale } from '@/i18n/page-locale';
import { Container } from '@/components/layout/container';
import { Breadcrumb } from '@/components/common/breadcrumb';
import { CATALOG_PAGE_SIZE, CatalogListing } from '@/components/product/catalog-listing';
import { ProductFeedGrid } from '@/components/product/product-feed';
import { getPublicSettings, listProducts, searchProducts } from '@/lib/api/server';
import { firstParam, parseCatalogFilters, type SearchParamsRecord } from '@/lib/catalog-query';

export const dynamic = 'force-dynamic';

/** Same bound as core `SearchQuerySchema.q`. */
const MAX_QUERY_LENGTH = 100;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

function readQuery(params: SearchParamsRecord): string {
  return (firstParam(params.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = createTranslator(await pageLocale(params));
  const q = readQuery(await searchParams);
  const title = q ? `${t('search.resultFor')} ‘${q}’` : t('search.allProducts');
  // Result pages are thin/duplicate content for crawlers.
  return { title: `${title} | ${t('common.brand')}`, robots: { index: false } };
}

/**
 * `?q=` → full-text search (`GET /v1/search`, relevance order, no filters in the API);
 * no query → every product (`GET /v1/products`) with sort + price filters.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const locale = await pageLocale(params);
  const t = createTranslator(locale);
  const query = await searchParams;
  const q = readQuery(query);

  return (
    <Container as="section" className="py-8 lg:py-12">
      <Breadcrumb
        label={t('catalog.breadcrumb')}
        className="mb-2"
        items={[{ label: t('common.home'), href: '/' }, { label: t('common.search') }]}
      />
      <h1 className="mb-8 font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {q ? `${t('search.resultFor')} ‘${q}’` : t('search.allProducts')}
      </h1>
      {q ? <SearchResults q={q} locale={locale} /> : <AllProducts locale={locale} query={query} />}
    </Container>
  );
}

async function SearchResults({ q, locale }: { q: string; locale: AppLocale }) {
  const page = await searchProducts(q, locale, CATALOG_PAGE_SIZE);
  return (
    <ProductFeedGrid
      key={q}
      initialPage={page}
      feed={{ kind: 'search', locale, q }}
      pageSize={CATALOG_PAGE_SIZE}
      className="lg:grid-cols-4"
    />
  );
}

async function AllProducts({ locale, query }: { locale: AppLocale; query: SearchParamsRecord }) {
  const settings = await getPublicSettings();
  const currency = settings.defaultCurrency;
  const filters = parseCatalogFilters(query, currency);
  const page = await listProducts({ locale, limit: CATALOG_PAGE_SIZE, ...filters });
  return (
    <CatalogListing
      page={page}
      filters={filters}
      currency={currency}
      feed={{ kind: 'products', locale, filters }}
    />
  );
}
