'use client';

import * as React from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { Check, ShoppingCart } from 'lucide-react';
import { Button } from '@repo/ui';
import type { ProductSummary } from '@repo/core';
import { formatMoney, translateError } from '@repo/i18n';
import { StarRating } from './star-rating';
import { ProductImage } from './product-image';
import { useLocale } from '../../i18n/use-locale';
import { fetchProduct } from '../../lib/api/browser';
import { purchasableVariants, toCartSnapshot } from '../../lib/cart';
import { cn } from '../../lib/utils';
import { useCart } from '../../store/cart-store';

type Variant = 'grid' | 'list' | 'compact';
type AddState = 'idle' | 'busy' | 'added' | 'error';

/** Product tile for lists and search results (`ProductSummary` from the catalog API). */
export function ProductCard({
  product,
  variant = 'grid',
  className,
}: {
  product: ProductSummary;
  variant?: Variant;
  className?: string;
}) {
  const { locale, t } = useLocale();
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
          <ProductImage
            src={product.primaryImageUrl}
            alt={product.name}
            className="size-20 rounded-md sm:size-24"
          />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div>
            <Link href={href}>
              <h3 className="line-clamp-2 text-body-m font-medium text-text-primary transition-colors group-hover:text-brand-text">
                {product.name}
              </h3>
            </Link>
            <ProductRating product={product} className="mt-1" />
          </div>
          <span className="text-body-l font-bold text-text-price">
            {formatMoney(product.basePrice, locale)}
          </span>
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
      <Link href={href} className="block overflow-hidden">
        <ProductImage
          src={product.primaryImageUrl}
          alt={product.name}
          className="aspect-square w-full transition-transform duration-300 group-hover:scale-105"
        />
      </Link>

      <div className={cn('flex flex-1 flex-col gap-2', compact ? 'p-3' : 'p-4')}>
        <Link href={href} className="flex-1">
          <h3
            className={cn(
              'line-clamp-2 font-medium text-text-primary transition-colors group-hover:text-brand-text',
              compact ? 'text-body-s' : 'text-body-m',
            )}
          >
            {product.name}
          </h3>
        </Link>
        {!compact ? <ProductRating product={product} /> : null}
        <span className="text-body-l font-bold text-text-price">
          {formatMoney(product.basePrice, locale)}
        </span>
        {!compact ? <QuickAdd product={product} label={t('common.addToCart')} /> : null}
      </div>
    </div>
  );
}

function ProductRating({ product, className }: { product: ProductSummary; className?: string }) {
  const { t } = useLocale();
  if (product.rating.average === null) {
    return (
      <span className={cn('text-body-s text-text-muted', className)}>{t('product.noRating')}</span>
    );
  }
  return (
    <StarRating value={product.rating.average} count={product.rating.count} className={className} />
  );
}

/**
 * "Add to cart" from a card: a summary has no variants, so the detail is fetched on click.
 * One buyable variant → added straight to the guest cart; several (or none in stock) → the
 * product page, where the shopper picks an option.
 */
function QuickAdd({ product, label }: { product: ProductSummary; label: string }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const { add } = useCart();
  const [state, setState] = React.useState<AddState>('idle');
  const [message, setMessage] = React.useState<string | null>(null);

  const onClick = async () => {
    setState('busy');
    setMessage(null);
    try {
      const detail = await fetchProduct(product.slug, locale);
      const buyable = detail ? purchasableVariants(detail) : [];
      const only = buyable[0];
      if (!detail || detail.variants.length !== 1 || !only) {
        setState('idle');
        router.push(`/product/${product.slug}`);
        return;
      }
      const result = add(toCartSnapshot(detail, only), 1);
      if (result === 'added') {
        setState('added');
        return;
      }
      setState('error');
      setMessage(
        result === 'currency-mismatch'
          ? translateError(locale, 'checkout.error.currency-mismatch')
          : t('product.outOfStock'),
      );
    } catch {
      setState('error');
      setMessage(translateError(locale, 'common.error.internal'));
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      <Button
        size="md"
        fullWidth
        iconLeft={
          state === 'added' ? <Check className="size-4" /> : <ShoppingCart className="size-4" />
        }
        disabled={state === 'busy'}
        aria-busy={state === 'busy'}
        onClick={() => void onClick()}
      >
        {state === 'added' ? t('product.added') : label}
      </Button>
      {message ? (
        <p role="alert" className="text-body-s text-danger-fg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
