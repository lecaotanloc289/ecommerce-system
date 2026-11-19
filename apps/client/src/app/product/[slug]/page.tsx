import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../components/product/product-detail';
import { getProduct, products } from '../../../mocks/products';

/** Pre-render every product slug for the static export. */
export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();
  return <ProductDetail product={product} />;
}
