import type { Metadata } from 'next';
import { createTranslator } from '@repo/i18n';
import { pageLocale } from '@/i18n/page-locale';
import { Container } from '@/components/layout/container';
import { Breadcrumb } from '@/components/common/breadcrumb';
import { CATALOG_PAGE_SIZE, CatalogListing } from '@/components/product/catalog-listing';
import { ProductImage } from '@/components/product/product-image';
import { getPublicSettings, getVendor } from '@/lib/api/server';
import { parseCatalogFilters, type SearchParamsRecord } from '@/lib/catalog-query';
import { catalogMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<SearchParamsRecord>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale(params);
  const { slug } = await params;
  // Same call as an unfiltered page render → deduplicated by the per-request memo.
  const vendor = await getVendor(slug, { locale, limit: CATALOG_PAGE_SIZE, sort: 'newest' });
  const t = createTranslator(locale);
  return catalogMetadata({
    title: `${vendor.displayName} | ${t('common.brand')}`,
    description: vendor.description ?? t('vendor.metaDescription', { name: vendor.displayName }),
    image: vendor.logoUrl,
  });
}

/** Public shop page: header + the shop's products (sort / price filters, load more). */
export default async function VendorPage({ params, searchParams }: Props) {
  const locale = await pageLocale(params);
  const { slug } = await params;
  const t = createTranslator(locale);
  const [settings, query] = await Promise.all([getPublicSettings(), searchParams]);
  const currency = settings.defaultCurrency;
  const filters = parseCatalogFilters(query, currency);
  const vendor = await getVendor(slug, { locale, limit: CATALOG_PAGE_SIZE, ...filters });

  return (
    <div className="flex flex-col">
      <section className="border-b border-border-subtle bg-bg-muted/30">
        <Container className="flex flex-col gap-4 py-8 lg:py-10">
          <Breadcrumb
            label={t('catalog.breadcrumb')}
            items={[{ label: t('common.home'), href: '/' }, { label: vendor.displayName }]}
          />
          <div className="flex items-center gap-4">
            <ProductImage
              src={vendor.logoUrl}
              alt={vendor.displayName}
              loading="eager"
              className="size-16 shrink-0 rounded-full border border-border-subtle lg:size-20"
            />
            <div className="min-w-0">
              <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
                {vendor.displayName}
              </h1>
              {vendor.description ? (
                <p className="mt-1 max-w-2xl text-body-m text-text-muted">{vendor.description}</p>
              ) : null}
            </div>
          </div>
        </Container>
      </section>

      <Container as="section" className="py-8 lg:py-12">
        <h2 className="mb-6 font-heading text-h5 font-semibold text-text-primary">
          {t('vendor.products')}
        </h2>
        <CatalogListing
          page={vendor.products}
          filters={filters}
          currency={currency}
          feed={{ kind: 'vendor', locale, vendorSlug: vendor.slug, filters }}
        />
      </Container>
    </div>
  );
}
