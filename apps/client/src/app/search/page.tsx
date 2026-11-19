'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import {
  Button,
  Checkbox,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@repo/ui';
import { Container } from '../../components/layout/container';
import { ProductCard } from '../../components/product/product-card';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney } from '../../lib/format';
import { products } from '../../mocks/products';
import { categories, brands } from '../../mocks/categories';
import { platformSettings } from '../../mocks/platform-settings';

/** Price slider bounds derived from the catalogue (mock data is single-currency). */
const priceCurrency = platformSettings.defaultCurrency;
const priceMax = products
  .filter((p) => p.price.currency === priceCurrency)
  .reduce((max, p) => Math.max(max, p.price.amount), 0);

function FilterPanel() {
  const { locale, t } = useLocale();
  // Rendered twice (sidebar + mobile drawer) — ids must be unique per instance.
  const ids = React.useId();
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('nav.categories')}
        </legend>
        {categories.map((c) => (
          <label key={c.id} className="flex items-center gap-2.5 text-body-m text-text-body">
            <Checkbox id={`${ids}-cat-${c.id}`} />
            <span className="flex-1">{c.name}</span>
            <span className="text-body-s text-text-muted">{c.productCount}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('search.brand')}
        </legend>
        {brands.slice(0, 6).map((b) => (
          <label key={b.id} className="flex items-center gap-2.5 text-body-m text-text-body">
            <Checkbox id={`${ids}-brand-${b.id}`} />
            {b.name}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('search.price')}
        </legend>
        <div className="flex items-center justify-between text-body-s text-text-muted">
          <span>{formatMoney({ amount: 0, currency: priceCurrency }, locale)}</span>
          <span>{formatMoney({ amount: priceMax, currency: priceCurrency }, locale)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={priceMax}
          defaultValue={priceMax}
          aria-label={t('search.price')}
          className="accent-[var(--color-brand-solid)]"
        />
      </fieldset>

      <div className="flex items-center justify-between border-t border-border-subtle pt-6">
        <Label htmlFor={`${ids}-in-stock`}>{t('search.inStockOnly')}</Label>
        <Switch id={`${ids}-in-stock`} />
      </div>
    </div>
  );
}

/** Case-insensitive match on title / brand / vendor, narrowed by category slug. */
function filterProducts(q: string, category: string) {
  const needle = q.trim().toLowerCase();
  return products.filter((p) => {
    if (category && p.categorySlug !== category) return false;
    if (!needle) return true;
    return [p.title, p.brand, p.vendorName].some((s) => s.toLowerCase().includes(needle));
  });
}

/** Reads `?q=` / `?category=`. useSearchParams needs the Suspense boundary below (static export). */
function SearchFromParams() {
  const params = useSearchParams();
  return <SearchView q={params.get('q') ?? ''} category={params.get('category') ?? ''} />;
}

export default function SearchPage() {
  return (
    <React.Suspense fallback={<SearchView q="" category="" />}>
      <SearchFromParams />
    </React.Suspense>
  );
}

function SearchView({ q, category }: { q: string; category: string }) {
  const { t } = useLocale();
  const results = filterProducts(q, category);
  const categoryName = categories.find((c) => c.slug === category)?.name;
  const title = q ? `${t('search.resultFor')} ‘${q}’` : (categoryName ?? t('search.allProducts'));

  return (
    <Container as="section" className="py-8 lg:py-12">
      {/* Breadcrumb + title */}
      <nav className="mb-2 flex items-center gap-2 text-body-s text-text-muted">
        <Link href="/" className="hover:text-brand-text">
          {t('common.home')}
        </Link>
        <span>/</span>
        <span className="text-text-body">{t('common.search')}</span>
      </nav>
      <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
        {title}
      </h1>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <FilterPanel />
        </aside>

        {/* Results */}
        <div className="flex-1">
          {/* Toolbar */}
          <div className="mb-6 flex items-center justify-between gap-3">
            <p className="text-body-m text-text-muted">
              {t('search.results', { count: results.length })}
            </p>
            <div className="flex items-center gap-2">
              {/* Mobile filter trigger */}
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="secondary" size="md" className="lg:hidden">
                    <SlidersHorizontal className="size-4" />
                    {t('search.filterOptions')}
                  </Button>
                </DrawerTrigger>
                <DrawerContent side="left" className="w-80 overflow-y-auto p-5">
                  <DrawerHeader>
                    <DrawerTitle className="font-heading text-h5">
                      {t('search.filterOptions')}
                    </DrawerTitle>
                  </DrawerHeader>
                  <FilterPanel />
                </DrawerContent>
              </Drawer>

              <Select defaultValue="relevance">
                <SelectTrigger className="w-44" aria-label={t('search.sortBy')}>
                  <SelectValue placeholder={t('search.sortBy')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">{t('search.relevance')}</SelectItem>
                  <SelectItem value="price-low">{t('search.priceLow')}</SelectItem>
                  <SelectItem value="price-high">{t('search.priceHigh')}</SelectItem>
                  <SelectItem value="newest">{t('search.newest')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Grid */}
          {/* All mock results fit on one page — pagination returns with the API. */}
          {results.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <p className="py-16 text-center text-body-m text-text-muted">{t('search.noResults')}</p>
          )}
        </div>
      </div>
    </Container>
  );
}
