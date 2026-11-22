'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowRight } from 'lucide-react';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { BenefitBar } from '@/components/common/benefit-bar';
import { SectionHeading } from '@/components/common/section-heading';
import { ProductCard } from '@/components/product/product-card';
import { CategoryItem } from '@/components/product/category-item';
import { BrandLogoRow } from '@/components/product/brand-logo-row';
import { useLocale, type MessageKey } from '@/i18n/use-locale';
import { formatMoney } from '@repo/i18n';
import { getProduct, products } from '@/mocks/products';
import { categories } from '@/mocks/categories';
import { cn } from '@/lib/utils';

const ALL = 'all';
const PROMO_SLUG = 'lenovo-yoga-x';

const blogPosts: { tag: MessageKey; title: MessageKey; minutes: number; seed: string }[] = [
  { tag: 'home.blog1Tag', title: 'home.blog1Title', minutes: 5, seed: 'blog-1' },
  { tag: 'home.blog2Tag', title: 'home.blog2Title', minutes: 7, seed: 'blog-2' },
  { tag: 'home.blog3Tag', title: 'home.blog3Title', minutes: 6, seed: 'blog-3' },
];

export default function HomePage() {
  const { locale, t } = useLocale();
  const [tab, setTab] = React.useState(ALL);
  const bestSellers = (
    tab === ALL ? products : products.filter((p) => p.categorySlug === tab)
  ).slice(0, 8);
  const promo = getProduct(PROMO_SLUG);
  const lists = [
    { title: t('home.productList1'), items: products.slice(0, 3) },
    { title: t('home.productList2'), items: products.slice(3, 6) },
    { title: t('home.bestSeller'), items: products.slice(6, 9) },
  ];

  return (
    <div className="flex flex-col">
      {/* 1. Hero — auto-advancing carousel (Elements/Header/001) */}
      <HeroCarousel />

      {/* 2. Benefits */}
      <BenefitBar />

      {/* 3. Best sellers — 2×4 grid + filter tabs */}
      <Container as="section" className="py-12 lg:py-16">
        <div className="mb-6 flex flex-col items-center gap-4">
          <h2 className="font-heading text-h4 font-bold tracking-tight text-text-primary md:text-h3">
            {t('home.bestSeller')}
          </h2>
          <div className="flex flex-wrap justify-center gap-2">
            {[{ slug: ALL, name: t('common.viewAll') }, ...categories.slice(0, 4)].map((c) => (
              <button
                key={c.slug}
                type="button"
                onClick={() => setTab(c.slug)}
                aria-pressed={tab === c.slug}
                className={cn(
                  'rounded-full px-4 py-1.5 text-body-s font-medium transition-colors',
                  tab === c.slug
                    ? 'bg-brand-solid text-text-on-primary'
                    : 'bg-bg-muted text-text-muted hover:text-text-body',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {bestSellers.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {bestSellers.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="text-center text-body-m text-text-muted">{t('search.noResults')}</p>
        )}
      </Container>

      {/* 4. Promo banner (Elements/Banner/006) — light mint */}
      {promo ? (
        <Container as="section" className="pb-12 lg:pb-16">
          <div className="grid items-center gap-6 overflow-hidden rounded-xl bg-tint-teal px-6 py-10 sm:px-10 lg:grid-cols-2 lg:py-12">
            <img
              src="https://picsum.photos/seed/lenovo-yoga/700/360"
              alt={promo.title}
              className="order-2 aspect-video w-full rounded-lg object-cover lg:order-1"
            />
            <div className="order-1 flex flex-col gap-4 lg:order-2">
              <h2 className="font-heading text-h3-alt font-bold tracking-tight text-text-primary sm:text-h3 lg:text-h2">
                {promo.title}
              </h2>
              <p className="text-h5 font-semibold text-text-price">
                {formatMoney(promo.price, locale)}
              </p>
              <ButtonLink size="lg" className="w-fit" href={`/product/${promo.slug}`}>
                {t('common.buyNow')}
              </ButtonLink>
            </div>
          </div>
        </Container>
      ) : null}

      {/* 5. Categories */}
      <Container as="section" className="pb-12 lg:pb-16">
        <SectionHeading
          title={t('home.category')}
          action={
            <ButtonLink variant="outline" size="md" href="/categories">
              {t('common.viewAll')}
            </ButtonLink>
          }
        />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((c) => (
            <CategoryItem key={c.id} category={c} />
          ))}
        </div>
      </Container>

      {/* 6. Product lists — 3 columns */}
      <Container as="section" className="grid gap-8 pb-12 md:grid-cols-3 lg:pb-16">
        {lists.map((col) => (
          <div key={col.title} className="flex flex-col">
            <h2 className="mb-4 font-heading text-h6 font-bold text-text-primary">{col.title}</h2>
            <div className="flex flex-col gap-3">
              {col.items.map((p) => (
                <ProductCard key={p.id} product={p} variant="list" />
              ))}
            </div>
            <Link
              href="/search"
              className="mt-4 inline-flex items-center gap-1 text-body-s font-medium text-brand-text hover:underline"
            >
              {t('common.viewAll')} <ArrowRight className="size-4" />
            </Link>
          </div>
        ))}
      </Container>

      {/* 7. Blog teaser */}
      <Container as="section" className="pb-12 lg:pb-16">
        <SectionHeading title={t('home.blog')} />
        <div className="grid gap-6 md:grid-cols-3">
          {/* Teasers only — no blog pages yet, so cards are not links. */}
          {blogPosts.map((post) => (
            <article
              key={post.seed}
              className="overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated"
            >
              <img
                src={`https://picsum.photos/seed/${post.seed}/480/300`}
                alt=""
                className="aspect-[16/10] w-full object-cover"
              />
              <div className="flex flex-col gap-2 p-4">
                <span className="text-body-s text-text-muted">
                  {t(post.tag)} · {t('home.blogReadTime', { minutes: post.minutes })}
                </span>
                <h3 className="text-body-l font-semibold text-text-primary">{t(post.title)}</h3>
              </div>
            </article>
          ))}
        </div>
      </Container>

      {/* 8. Brand strip */}
      <Container as="section" className="pb-16">
        <BrandLogoRow />
      </Container>
    </div>
  );
}
