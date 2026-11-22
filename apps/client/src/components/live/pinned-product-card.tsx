'use client';

import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@repo/ui';
import { formatMoney } from '@repo/i18n';
import { useLocale } from '../../i18n/locale-provider';
import { useCart } from '../../store/cart-store';
import { cn } from '../../lib/utils';
import type { Product } from '../../types';

/** Compact product row: the "featured now" card when `highlighted`, a drawer row otherwise. */
export function PinnedProductCard({
  product,
  highlighted = false,
  className,
}: {
  product: Product;
  highlighted?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const { add } = useCart();

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-bg-elevated p-3',
        highlighted ? 'border-brand-solid shadow-1' : 'border-border-subtle',
        className,
      )}
    >
      <Link href={`/product/${product.slug}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <img
          src={product.image}
          alt=""
          className="size-16 rounded-md object-cover"
          loading="lazy"
        />
      </Link>
      <div className="min-w-0 flex-1">
        {highlighted ? (
          <span className="text-caption font-semibold uppercase tracking-wide text-brand-text">
            {t('live.pinnedProduct')}
          </span>
        ) : null}
        <Link href={`/product/${product.slug}`}>
          <h3 className="line-clamp-1 text-body-m font-medium text-text-primary">
            {product.title}
          </h3>
        </Link>
        <span className="text-body-m font-bold text-text-price">
          {formatMoney(product.price, locale)}
        </span>
      </div>
      <Button
        size="sm"
        iconLeft={<ShoppingCart className="size-4" aria-hidden />}
        disabled={!product.inStock}
        onClick={() => add(product.id, product.variants?.[0]?.id, 1)}
        className="shrink-0"
      >
        {product.inStock ? t('common.addToCart') : t('product.outOfStock')}
      </Button>
    </div>
  );
}
