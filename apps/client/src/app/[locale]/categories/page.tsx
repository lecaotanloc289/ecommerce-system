import type { Metadata } from 'next';
import { ChevronRight } from 'lucide-react';
import { createTranslator } from '@repo/i18n';
import { Link } from '@/i18n/navigation';
import { pageLocale } from '@/i18n/page-locale';
import { Container } from '@/components/layout/container';
import { Breadcrumb } from '@/components/common/breadcrumb';
import { CategoryItem } from '@/components/product/category-item';
import { getCategoryTree } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = createTranslator(await pageLocale(params));
  return {
    title: `${t('categories.title')} | ${t('common.brand')}`,
    description: t('categories.subtitle'),
  };
}

export default async function CategoriesPage({ params }: Props) {
  const locale = await pageLocale(params);
  const t = createTranslator(locale);
  const tree = await getCategoryTree(locale);

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
          <Breadcrumb
            label={t('catalog.breadcrumb')}
            items={[{ label: t('common.home'), href: '/' }, { label: t('nav.categories') }]}
          />
        </Container>
      </section>

      {/* Root categories with their children */}
      <Container as="section" className="py-12 lg:py-16">
        {tree.items.length === 0 ? (
          <p className="text-center text-body-m text-text-muted">{t('catalog.noCategories')}</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {tree.items.map((category) => (
              <div
                key={category.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated"
              >
                <CategoryItem category={category} className="rounded-none border-0 border-b" />
                {category.children.length > 0 ? (
                  <ul className="flex flex-col px-5 pb-2">
                    {category.children.map((sub) => (
                      <li key={sub.id}>
                        <Link
                          href={`/categories/${sub.slug}`}
                          className="flex items-center gap-2 border-t border-border-subtle py-2.5 text-body-m text-text-body transition-colors first:border-t-0 hover:text-brand-text"
                        >
                          <ChevronRight className="size-4 text-text-muted" aria-hidden />
                          {sub.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Container>
    </div>
  );
}
