'use client';

import { formatMoney } from '@repo/i18n';
import { useLocale } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';
import type { MockLiveProduct } from '../../mocks/live';

/**
 * Compact product row: the "featured now" card when `highlighted`, a drawer row otherwise.
 * Display-only while the live pages run on mock data (the mock products are not in the catalog,
 * so there is no product link or add-to-cart yet).
 */
export function PinnedProductCard({
  product,
  highlighted = false,
  className,
}: {
  product: MockLiveProduct;
  highlighted?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-bg-elevated p-3',
        highlighted ? 'border-brand-solid shadow-1' : 'border-border-subtle',
        className,
      )}
    >
      <img
        src={product.image}
        alt=""
        className="size-16 shrink-0 rounded-md object-cover"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        {highlighted ? (
          <span className="text-caption font-semibold uppercase tracking-wide text-brand-text">
            {t('live.pinnedProduct')}
          </span>
        ) : null}
        <h3 className="line-clamp-1 text-body-m font-medium text-text-primary">{product.title}</h3>
        <span className="text-body-m font-bold text-text-price">
          {product.inStock ? formatMoney(product.price, locale) : t('product.outOfStock')}
        </span>
      </div>
    </div>
  );
}
