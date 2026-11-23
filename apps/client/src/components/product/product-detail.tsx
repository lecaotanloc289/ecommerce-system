'use client';

import * as React from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { ShoppingCart, Store } from 'lucide-react';
import { Button, Card, Tag } from '@repo/ui';
import type {
  Category,
  ProductDetail as ProductDetailData,
  ProductSummary,
  ReviewPage,
} from '@repo/core';
import { formatMoney, translateError } from '@repo/i18n';
import { describeError } from '../../lib/api/error-message';
import { Container } from '../layout/container';
import { Breadcrumb } from '../common/breadcrumb';
import { SectionHeading } from '../common/section-heading';
import { ProductCard } from './product-card';
import { ProductImage } from './product-image';
import { ProductReviews } from './product-reviews';
import { useReviewSubOrderId } from '../review/review-entry';
import { StarRating } from './star-rating';
import { QuantityStepper } from '../checkout/quantity-stepper';
import { useLocale, type MessageKey } from '../../i18n/use-locale';
import { defaultVariant, maxQtyFor, toCartSnapshot, variantLabel } from '../../lib/cart';
import { cn } from '../../lib/utils';
import { useCart } from '../../store/cart-store';

type Tab = 'description' | 'reviews' | 'related';
const TAB_LABEL: Record<Tab, MessageKey> = {
  description: 'product.description',
  reviews: 'product.reviews',
  related: 'product.related',
};

/**
 * Product page body (client: variant choice, quantity, add-to-cart, tabs). All data comes from
 * the RSC page: `GET /v1/products/:slug`, its reviews, category path and related products.
 */
export function ProductDetail({
  product,
  reviews,
  categoryPath,
  related,
}: {
  product: ProductDetailData;
  reviews: ReviewPage | null;
  categoryPath: Pick<Category, 'id' | 'name' | 'slug'>[];
  related: ProductSummary[];
}) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const { add } = useCart();
  const ids = React.useId();

  const gallery = React.useMemo(() => {
    const urls = [...product.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({ url: img.url, alt: img.alt }));
    if (urls.length === 0 && product.primaryImageUrl) {
      urls.push({ url: product.primaryImageUrl, alt: null });
    }
    return urls;
  }, [product]);
  const [activeImage, setActiveImage] = React.useState(0);

  const [variantId, setVariantId] = React.useState(() => defaultVariant(product)?.id);
  const selected = product.variants.find((v) => v.id === variantId);
  const maxQty = selected ? maxQtyFor(selected.stockAvailable) : 0;
  const canBuy = maxQty > 0;
  const [qty, setQty] = React.useState(1);
  const [message, setMessage] = React.useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const price = selected?.price ?? product.basePrice;

  const tabs: Tab[] = [
    ...(product.description ? (['description'] as const) : []),
    'reviews',
    ...(related.length > 0 ? (['related'] as const) : []),
  ];
  // `?reviewSubOrderId=` (link from a delivered order) opens the reviews tab with the form.
  const wantsReview = useReviewSubOrderId() !== null;
  const [tab, setTab] = React.useState<Tab>(wantsReview ? 'reviews' : (tabs[0] ?? 'reviews'));
  const tabRefs = React.useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabId = (key: Tab) => `${ids}-tab-${key}`;
  const panelId = (key: Tab) => `${ids}-panel-${key}`;

  /** Adds the selected variant; true when it landed in the cart. */
  const addToCart = async (): Promise<boolean> => {
    if (!selected) return false;
    let result: Awaited<ReturnType<typeof add>>;
    try {
      result = await add(toCartSnapshot(product, selected), qty);
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(locale, e) });
      return false;
    }
    if (result === 'added') {
      setMessage({ tone: 'success', text: t('product.added') });
      return true;
    }
    setMessage({
      tone: 'error',
      text:
        result === 'currency-mismatch'
          ? translateError(locale, 'checkout.error.currency-mismatch')
          : t('product.outOfStock'),
    });
    return false;
  };

  // WAI-ARIA tabs: arrow keys move focus + selection, Home/End jump to the ends.
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const nextIndex =
      e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : undefined;
    if (nextIndex === undefined) return;
    e.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const variantLabelId = `${ids}-variant`;
  const qtyLabelId = `${ids}-qty`;
  const active = gallery[activeImage] ?? gallery[0];

  return (
    <div className="flex flex-col">
      <Container className="py-6 lg:py-10">
        <Breadcrumb
          label={t('catalog.breadcrumb')}
          className="mb-6"
          items={[
            { label: t('common.home'), href: '/' },
            ...categoryPath.map((c) => ({ label: c.name, href: `/categories/${c.slug}` })),
            { label: product.name },
          ]}
        />

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Gallery */}
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
              <ProductImage
                src={active?.url}
                alt={active?.alt ?? product.name}
                loading="eager"
                className="aspect-square w-full"
              />
            </div>
            {gallery.length > 1 ? (
              <div className="flex gap-3 overflow-x-auto">
                {gallery.map((img, i) => (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={t('product.viewImage', { n: i + 1 })}
                    aria-pressed={i === activeImage}
                    className={cn(
                      'size-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors',
                      i === activeImage
                        ? 'border-brand-solid'
                        : 'border-border-subtle hover:border-border-default',
                    )}
                  >
                    <img src={img.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Buy box */}
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
                {product.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {product.rating.average !== null ? (
                  <>
                    <Tag variant="warning">
                      <StarRating value={product.rating.average} />
                    </Tag>
                    <span className="text-body-s text-text-muted">
                      {product.rating.average.toFixed(1)} ·{' '}
                      {t('product.reviewsCount', { count: product.rating.count })}
                    </span>
                  </>
                ) : (
                  <span className="text-body-s text-text-muted">{t('product.noRating')}</span>
                )}
              </div>
            </div>

            <span className="text-h3 font-bold text-text-price">{formatMoney(price, locale)}</span>

            {/* Variants: one chip per variant; sold-out ones are disabled. */}
            {product.variants.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span id={variantLabelId} className="text-body-s text-text-muted">
                  {t('product.variant')}
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={variantLabelId}
                  className="flex flex-wrap gap-2"
                >
                  {product.variants.map((v) => {
                    const soldOut = v.stockAvailable <= 0;
                    const checked = v.id === variantId;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        disabled={soldOut}
                        onClick={() => {
                          setVariantId(v.id);
                          setQty((q) => Math.max(1, Math.min(q, maxQtyFor(v.stockAvailable))));
                          setMessage(null);
                        }}
                        className={cn(
                          'rounded-md border px-3 py-2 text-body-s font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                          checked
                            ? 'border-brand-solid bg-brand-soft text-brand-text'
                            : 'border-border-default text-text-body hover:border-brand-solid',
                          soldOut &&
                            'cursor-not-allowed border-border-subtle text-text-disabled line-through hover:border-border-subtle',
                        )}
                      >
                        {variantLabel(v)}
                        {soldOut ? (
                          <span className="sr-only"> — {t('product.outOfStock')}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <span id={qtyLabelId} className="text-body-s text-text-muted">
                  {t('product.quantity')}
                </span>
                <QuantityStepper
                  value={qty}
                  onChange={setQty}
                  max={Math.max(1, maxQty)}
                  labelledBy={qtyLabelId}
                />
              </div>
              <span
                className={cn('pb-2 text-body-s', canBuy ? 'text-success-fg' : 'text-danger-fg')}
              >
                {canBuy
                  ? t('product.stockLeft', { count: selected?.stockAvailable ?? 0 })
                  : t('product.outOfStock')}
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                variant="outline"
                fullWidth
                disabled={!canBuy}
                onClick={() => {
                  void addToCart().then((added) => {
                    if (added) router.push('/cart');
                  });
                }}
              >
                {t('common.buyNow')}
              </Button>
              <Button
                size="lg"
                fullWidth
                iconLeft={<ShoppingCart className="size-5" />}
                disabled={!canBuy}
                onClick={() => void addToCart()}
              >
                {canBuy ? t('common.addToCart') : t('product.outOfStock')}
              </Button>
            </div>
            <p
              role="status"
              className={cn(
                'min-h-5 text-body-s',
                message?.tone === 'error' ? 'text-danger-fg' : 'text-success-fg',
              )}
            >
              {message?.text}
            </p>

            {/* Vendor card */}
            <Card className="flex items-center gap-4 p-4">
              <ProductImage
                src={product.vendor.logoUrl}
                alt={product.vendor.displayName}
                className="size-12 shrink-0 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <p className="text-body-s text-text-muted">{t('product.soldBy')}</p>
                <p className="truncate text-body-m font-semibold text-text-primary">
                  {product.vendor.displayName}
                </p>
              </div>
              <Link
                href={`/vendors/${product.vendor.slug}`}
                className="inline-flex items-center gap-1.5 text-body-s font-medium text-brand-text hover:underline"
              >
                <Store className="size-4" aria-hidden />
                {t('product.visitShop')}
              </Link>
            </Card>
          </div>
        </div>
      </Container>

      {/* Tabs */}
      <div className="border-y border-border-subtle">
        <Container>
          <div role="tablist" aria-label={product.name} className="flex gap-1">
            {tabs.map((key, i) => (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[key] = el;
                }}
                id={tabId(key)}
                type="button"
                role="tab"
                aria-selected={tab === key}
                // Only the active panel is mounted, so only it can be referenced.
                aria-controls={tab === key ? panelId(key) : undefined}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={cn(
                  'relative px-4 py-4 text-body-m font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus',
                  tab === key ? 'text-brand-text' : 'text-text-muted hover:text-text-body',
                )}
              >
                {t(TAB_LABEL[key])}
                {tab === key ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-solid" />
                ) : null}
              </button>
            ))}
          </div>
        </Container>
      </div>

      {tab === 'description' && product.description ? (
        <div
          role="tabpanel"
          tabIndex={0}
          id={panelId('description')}
          aria-labelledby={tabId('description')}
        >
          <Container as="section" className="py-10">
            <p className="max-w-3xl whitespace-pre-line text-body-m text-text-body">
              {product.description}
            </p>
          </Container>
        </div>
      ) : null}

      {tab === 'reviews' ? (
        <div
          role="tabpanel"
          tabIndex={0}
          id={panelId('reviews')}
          aria-labelledby={tabId('reviews')}
        >
          <Container as="section" className="py-10">
            <ProductReviews
              productId={product.id}
              initialPage={reviews}
              fallbackSummary={product.rating}
            />
          </Container>
        </div>
      ) : null}

      {tab === 'related' ? (
        <div
          role="tabpanel"
          tabIndex={0}
          id={panelId('related')}
          aria-labelledby={tabId('related')}
        >
          <Container as="section" className="py-8 pb-16">
            <SectionHeading title={t('product.related')} />
            <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </Container>
        </div>
      ) : null}
    </div>
  );
}
