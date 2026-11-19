'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Container } from '../../components/layout/container';
import { SectionHeading } from '../../components/common/section-heading';
import { BrandLogoRow } from '../../components/product/brand-logo-row';
import { useT } from '../../i18n/locale-provider';
import { categories } from '../../mocks/categories';

export default function CategoriesPage() {
  const t = useT();

  return (
    <div className="flex flex-col">
      {/* Title + breadcrumb */}
      <section className="border-b border-border-subtle bg-bg-muted/30">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-8 lg:py-10">
          <div>
            <h1 className="font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
              {t('categories.title')}
            </h1>
            <p className="mt-1 text-body-m text-text-muted">{t('categories.subtitle')}</p>
          </div>
          <nav className="flex items-center gap-2 text-body-s text-text-muted">
            <Link href="/" className="hover:text-brand-text">
              {t('common.home')}
            </Link>
            <span>/</span>
            <Link href="/search" className="hover:text-brand-text">
              {t('nav.shop')}
            </Link>
            <span>/</span>
            <span className="text-brand-text">{t('nav.categories')}</span>
          </nav>
        </Container>
      </section>

      {/* Category cards with sub-category lists */}
      <Container as="section" className="py-12 lg:py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated"
            >
              <Link href={`/search?category=${category.slug}`} className="block bg-bg-muted/50">
                <img
                  src={category.image}
                  alt={category.name}
                  className="aspect-[16/10] w-full object-cover"
                />
              </Link>
              <div className="flex flex-1 flex-col p-5">
                <div className="mb-3 flex items-center justify-between">
                  <Link
                    href={`/search?category=${category.slug}`}
                    className="font-heading text-h6 font-bold text-text-primary hover:text-brand-text"
                  >
                    {category.name}
                  </Link>
                  <span className="text-body-s font-medium text-brand-text">
                    {t('categories.productsCount', { count: category.productCount })}
                  </span>
                </div>
                <ul className="flex flex-col">
                  {category.subcategories.map((sub) => (
                    <li key={sub}>
                      <Link
                        href={`/search?category=${category.slug}`}
                        className="flex items-center gap-2 border-t border-border-subtle py-2.5 text-body-m text-text-body transition-colors hover:text-brand-text"
                      >
                        <ChevronRight className="size-4 text-text-muted" />
                        {t(`subcategories.${sub}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Popular brands */}
      <Container as="section" className="pb-16">
        <SectionHeading title={t('categories.popularBrands')} align="center" />
        <p className="-mt-4 mb-8 text-center text-body-m text-text-muted">
          {t('categories.popularBrandsDesc')}
        </p>
        <BrandLogoRow boxed />
      </Container>
    </div>
  );
}
