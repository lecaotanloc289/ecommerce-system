import type { Metadata } from 'next';
import type { CategoryNode, CategoryTree } from '@repo/core';
import { createTranslator } from '@repo/i18n';
import { redirect } from '@/i18n/navigation';
import { pageLocale } from '@/i18n/page-locale';
import { ProductDetail } from '@/components/product/product-detail';
import { getCategoryTree, getProduct, getProductReviews, listProducts } from '@/lib/api/server';
import { catalogMetadata } from '@/lib/metadata';

// Rendered per request (stock and prices change); slugs come from the API.
export const dynamic = 'force-dynamic';

const RELATED_LIMIT = 5;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await pageLocale(params);
  const { slug } = await params;
  const product = await getProduct(slug, locale);
  const t = createTranslator(locale);
  return catalogMetadata({
    title: `${product.name} | ${t('common.brand')}`,
    description: product.description,
    image: product.primaryImageUrl ?? product.images[0]?.url,
  });
}

/** First category of the product found in the tree, with its path from the root. */
function findCategoryPath(tree: CategoryTree, ids: readonly string[]): CategoryNode[] {
  const walk = (nodes: CategoryNode[], path: CategoryNode[]): CategoryNode[] | null => {
    for (const node of nodes) {
      const next = [...path, node];
      if (ids.includes(node.id)) return next;
      const found = walk(node.children, next);
      if (found) return found;
    }
    return null;
  };
  return walk(tree.items, []) ?? [];
}

export default async function ProductPage({ params }: Props) {
  const locale = await pageLocale(params);
  const { slug } = await params;
  const product = await getProduct(slug, locale);
  // Any language's slug resolves; keep the URL in the page's language.
  if (product.slug !== slug) redirect({ href: `/product/${product.slug}`, locale });

  // Reviews run in parallel with tree → related (which needs the category slug).
  const reviewsPromise = getProductReviews(product.id);
  const tree = await getCategoryTree(locale);
  const categoryPath = findCategoryPath(tree, product.categoryIds);
  const category = categoryPath.at(-1);
  const [reviews, relatedPage] = await Promise.all([
    reviewsPromise,
    category
      ? listProducts({ locale, categorySlug: category.slug, limit: RELATED_LIMIT })
      : Promise.resolve(null),
  ]);
  const related = (relatedPage?.items ?? [])
    .filter((p) => p.id !== product.id)
    .slice(0, RELATED_LIMIT - 1);

  return (
    <ProductDetail
      // New product (related link, locale switch) → fresh variant/qty/tab state.
      key={product.id}
      product={product}
      reviews={reviews}
      categoryPath={categoryPath.map(({ id, name, slug: s }) => ({ id, name, slug: s }))}
      related={related}
    />
  );
}
