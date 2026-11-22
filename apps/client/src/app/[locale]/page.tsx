import { ArrowRight } from 'lucide-react';
import { createTranslator, type MessageKey } from '@repo/i18n';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/i18n/page-locale';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { BenefitBar } from '@/components/common/benefit-bar';
import { SectionHeading } from '@/components/common/section-heading';
import { ProductCard } from '@/components/product/product-card';
import { CategoryItem } from '@/components/product/category-item';
import { getCategoryTree, listProducts } from '@/lib/api/server';

// Latest products are read per request (no ISR with OpenNext's read-only cache).
export const dynamic = 'force-dynamic';

const LATEST_LIMIT = 8;
const LIST_LIMIT = 3;

const blogPosts: { tag: MessageKey; title: MessageKey; minutes: number; seed: string }[] = [
  { tag: 'home.blog1Tag', title: 'home.blog1Title', minutes: 5, seed: 'blog-1' },
  { tag: 'home.blog2Tag', title: 'home.blog2Title', minutes: 7, seed: 'blog-2' },
  { tag: 'home.blog3Tag', title: 'home.blog3Title', minutes: 6, seed: 'blog-3' },
];

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await pageLocale(params);
  const t = createTranslator(locale);
  const [latest, topRated, bestPrices, tree] = await Promise.all([
    listProducts({ locale, sort: 'newest', limit: LATEST_LIMIT }),
    listProducts({ locale, sort: 'rating', limit: LIST_LIMIT }),
    listProducts({ locale, sort: 'price_asc', limit: LIST_LIMIT }),
    getCategoryTree(locale),
  ]);
  const lists = [
    { title: t('home.topRated'), items: topRated.items, href: '/search?sort=rating' },
    { title: t('home.bestPrices'), items: bestPrices.items, href: '/search?sort=price_asc' },
    { title: t('home.newArrivals'), items: latest.items.slice(0, LIST_LIMIT), href: '/search' },
  ];

  return (
    <div className="flex flex-col">
      {/* 1. Hero — auto-advancing carousel (Elements/Header/001) */}
      <HeroCarousel />

      {/* 2. Benefits */}
      <BenefitBar />

      {/* 3. Latest products (GET /v1/products?sort=newest) */}
      <Container as="section" className="py-12 lg:py-16">
        <SectionHeading
          title={t('home.latest')}
          action={
            <ButtonLink variant="outline" size="md" href="/search">
              {t('common.viewAll')}
            </ButtonLink>
          }
        />
        {latest.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {latest.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        ) : (
          <p className="text-center text-body-m text-text-muted">{t('search.noResults')}</p>
        )}
      </Container>

      {/* 4. Categories (roots of the tree) */}
      {tree.items.length > 0 ? (
        <Container as="section" className="pb-12 lg:pb-16">
          <SectionHeading
            title={t('home.category')}
            action={
              <ButtonLink variant="outline" size="md" href="/categories">
                {t('common.viewAll')}
              </ButtonLink>
            }
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {tree.items.map((c) => (
              <CategoryItem key={c.id} category={c} />
            ))}
          </div>
        </Container>
      ) : null}

      {/* 5. Product lists — 3 columns */}
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
              href={col.href}
              className="mt-4 inline-flex items-center gap-1 text-body-s font-medium text-brand-text hover:underline"
            >
              {t('common.viewAll')} <ArrowRight className="size-4" />
            </Link>
          </div>
        ))}
      </Container>

      {/* 6. Blog teaser */}
      <Container as="section" className="pb-16">
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
    </div>
  );
}
