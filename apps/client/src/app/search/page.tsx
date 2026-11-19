'use client';

import * as React from 'react';
import Link from 'next/link';
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
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

function FilterPanel() {
  const { locale, t } = useLocale();
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('nav.categories')}
        </legend>
        {categories.map((c) => (
          <label key={c.id} className="flex items-center gap-2.5 text-body-m text-text-body">
            <Checkbox id={`cat-${c.id}`} />
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
            <Checkbox id={`brand-${b.id}`} />
            {b.name}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-3 border-t border-border-subtle pt-6">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('search.price')}
        </legend>
        <div className="flex items-center justify-between text-body-s text-text-muted">
          <span>{formatMoney({ amount: 0, currency: 'VND' }, locale)}</span>
          <span>{formatMoney({ amount: 60_000_000, currency: 'VND' }, locale)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={60_000_000}
          defaultValue={30_000_000}
          aria-label={t('search.price')}
          className="accent-[var(--color-brand-solid)]"
        />
      </fieldset>

      <div className="flex items-center justify-between border-t border-border-subtle pt-6">
        <Label htmlFor="in-stock">{t('search.inStockOnly')}</Label>
        <Switch id="in-stock" />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const { t } = useLocale();
  const query = 'Macbook Pro';

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
        {t('search.resultFor')} &lsquo;{query}&rsquo;
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
              {t('search.results', { count: products.length })}
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
                <SelectTrigger className="w-44">
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
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {/* Pagination */}
          <Pagination className="mt-10">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              {[1, 2, 3, 4].map((n) => (
                <PaginationItem key={n}>
                  <PaginationLink href="#" isActive={n === 1}>
                    {n}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
    </Container>
  );
}
