'use client';

import Link from 'next/link';
import { Heart, ShoppingCart } from 'lucide-react';
import { Badge, Button } from '@repo/ui';
import { StarRating } from './star-rating';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney } from '../../lib/format';
import { cn } from '../../lib/utils';
import { useCart } from '../../store/cart-store';
import type { Product } from '../../types';

type Variant = 'grid' | 'list' | 'compact';

const badgeTone: Record<NonNullable<Product['badge']>, 'danger' | 'success' | 'warning'> = {
  sale: 'danger',
  new: 'success',
  bestseller: 'warning',
};

export function ProductCard({
  product,
  variant = 'grid',
  className,
}: {
  product: Product;
  variant?: Variant;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const { add } = useCart();
  const href = `/product/${product.slug}`;

  if (variant === 'list') {
    return (
      <div
        className={cn(
          'group flex gap-4 rounded-lg border border-border-subtle bg-bg-elevated p-3 transition-shadow hover:shadow-1',
          className,
        )}
      >
        <Link href={href} className="shrink-0">
          <img
            src={product.image}
            alt={product.title}
            className="size-20 rounded-md object-cover sm:size-24"
            loading="lazy"
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <Link href={href}>
              <h3 className="line-clamp-2 text-body-m font-medium text-text-primary transition-colors group-hover:text-brand-text">
                {product.title}
              </h3>
            </Link>
            <StarRating value={product.rating} count={product.reviewCount} className="mt-1" />
          </div>
          <PriceRow product={product} locale={locale} />
        </div>
      </div>
    );
  }

  const compact = variant === 'compact';

  return (
    <div
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated transition-shadow hover:shadow-1',
        className,
      )}
    >
      <div className="relative">
        <Link href={href} className="block overflow-hidden">
          <img
            src={product.image}
            alt={product.title}
            className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        </Link>
        {product.badge ? (
          <Badge variant={badgeTone[product.badge]} className="absolute left-3 top-3">
            {t(`product.badge.${product.badge}`)}
          </Badge>
        ) : null}
        <button
          type="button"
          aria-label={t('product.wishlist')}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full bg-bg-elevated/90 text-text-muted shadow-1 transition-colors hover:text-danger-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <Heart className="size-4" />
        </button>
      </div>

      <div className={cn('flex flex-1 flex-col gap-2', compact ? 'p-3' : 'p-4')}>
        {!compact ? <span className="text-body-s text-text-muted">{product.brand}</span> : null}
        <Link href={href} className="flex-1">
          <h3
            className={cn(
              'line-clamp-2 font-medium text-text-primary transition-colors group-hover:text-brand-text',
              compact ? 'text-body-s' : 'text-body-m',
            )}
          >
            {product.title}
          </h3>
        </Link>
        {!compact ? <StarRating value={product.rating} count={product.reviewCount} /> : null}
        <PriceRow product={product} locale={locale} />
        {!compact ? (
          <Button
            size="md"
            fullWidth
            iconLeft={<ShoppingCart className="size-4" />}
            disabled={!product.inStock}
            onClick={() => add(product.id, product.variants?.[0]?.id, 1)}
            className="mt-1"
          >
            {product.inStock ? t('common.addToCart') : t('product.outOfStock')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PriceRow({
  product,
  locale,
}: {
  product: Product;
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-body-l font-bold text-text-price">
        {formatMoney(product.price, locale)}
      </span>
      {product.compareAt ? (
        <span className="text-body-s text-text-muted line-through">
          {formatMoney(product.compareAt, locale)}
        </span>
      ) : null}
    </div>
  );
}
