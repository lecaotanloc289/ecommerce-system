'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Heart, ShoppingCart, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tag,
  Textarea,
} from '@repo/ui';
import { Container } from '../layout/container';
import { SectionHeading } from '../common/section-heading';
import { ProductCard } from './product-card';
import { StarRating } from './star-rating';
import { QuantityStepper } from '../checkout/quantity-stepper';
import { useLocale, type MessageKey } from '../../i18n/locale-provider';
import { MAX_LINE_QTY } from '../../lib/cart';
import { formatCompact, formatMoney, formatDate } from '@repo/i18n';
import { cn } from '../../lib/utils';
import { categories } from '../../mocks/categories';
import { products, reviews } from '../../mocks/products';
import { useCart } from '../../store/cart-store';
import type { Product } from '../../types';

type Tab = 'overview' | 'reviews' | 'related';
const TAB_LABEL: Record<Tab, MessageKey> = {
  overview: 'product.overview',
  reviews: 'product.reviews',
  related: 'product.related',
};

/** Placeholder Select value when a product has no variants. */
const STANDARD = 'standard';

const dist: [number, number][] = [
  [5, 88],
  [4, 64],
  [3, 24],
  [2, 8],
  [1, 4],
];

export function ProductDetail({ product }: { product: Product }) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const { add } = useCart();
  const ids = React.useId();
  const [activeImage, setActiveImage] = React.useState(0);
  const [activeColor, setActiveColor] = React.useState(0);

  const variants = product.variants ?? [];
  const [variantId, setVariantId] = React.useState<string | undefined>(variants[0]?.id);
  const selectedVariant = variants.find((v) => v.id === variantId);
  const maxQty = selectedVariant ? Math.min(selectedVariant.stock, MAX_LINE_QTY) : MAX_LINE_QTY;
  const [qty, setQty] = React.useState(1);
  const canBuy = product.inStock && (!selectedVariant || selectedVariant.stock > 0);

  const price = selectedVariant?.price ?? product.price;
  const showCompareAt = product.compareAt && product.compareAt.amount > price.amount;

  const hasOverview = Boolean(product.specs?.length || product.boxItems?.length);
  const tabs: Tab[] = hasOverview ? ['overview', 'reviews', 'related'] : ['reviews', 'related'];
  const [tab, setTab] = React.useState<Tab>(tabs[0] ?? 'reviews');
  const tabRefs = React.useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabId = (key: Tab) => `${ids}-tab-${key}`;
  const panelId = (key: Tab) => `${ids}-panel-${key}`;

  const related = products
    .filter((p) => p.categorySlug === product.categorySlug && p.id !== product.id)
    .slice(0, 4);

  const addToCart = () => add(product.id, selectedVariant?.id, qty);

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

  const typeLabelId = `${ids}-type`;
  const qtyLabelId = `${ids}-qty`;
  const colorLabelId = `${ids}-color`;

  return (
    <div className="flex flex-col">
      <Container className="py-6 lg:py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-body-s text-text-muted">
          <Link href="/" className="hover:text-brand-text">
            {t('common.home')}
          </Link>
          <span>/</span>
          <Link href={`/search?category=${product.categorySlug}`} className="hover:text-brand-text">
            {categories.find((c) => c.slug === product.categorySlug)?.name ?? product.categorySlug}
          </Link>
        </nav>

        {/* Product card details */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Gallery */}
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
              <img
                src={product.gallery[activeImage] ?? product.image}
                alt={product.title}
                className="aspect-square w-full object-cover"
              />
            </div>
            {product.gallery.length > 1 ? (
              <div className="flex gap-3">
                {product.gallery.map((src, i) => (
                  <button
                    key={src}
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
                    <img src={src} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Buy box */}
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary lg:text-h3">
                {product.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Tag variant="warning">
                  <StarRating value={product.rating} />
                </Tag>
                <span className="text-body-s text-text-muted">
                  {product.rating} · {product.reviewCount} {t('product.reviews')}
                </span>
              </div>
            </div>

            {product.description ? (
              <p className="text-body-m text-text-muted">{product.description}</p>
            ) : null}

            {/* Type / Quantity / Color */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <span id={typeLabelId} className="text-body-s text-text-muted">
                  {t('product.type')}
                </span>
                {variants.length > 0 ? (
                  <Select
                    value={variantId ?? ''}
                    onValueChange={(v) => {
                      const next = variants.find((x) => x.id === v);
                      if (!next) return;
                      setVariantId(next.id);
                      setQty((q) => Math.max(1, Math.min(q, next.stock)));
                    }}
                  >
                    <SelectTrigger aria-labelledby={typeLabelId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={STANDARD} disabled>
                    <SelectTrigger aria-labelledby={typeLabelId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={STANDARD}>{t('product.standard')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
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
              {product.colors ? (
                <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                  <span id={colorLabelId} className="text-body-s text-text-muted">
                    {t('product.color')}
                  </span>
                  <div role="group" aria-labelledby={colorLabelId} className="flex gap-2">
                    {product.colors.map((color, i) => (
                      <button
                        key={color.hex}
                        type="button"
                        onClick={() => setActiveColor(i)}
                        aria-label={t(`colors.${color.name}`)}
                        aria-pressed={i === activeColor}
                        title={t(`colors.${color.name}`)}
                        className={cn(
                          'size-9 rounded-full border-2 transition',
                          i === activeColor
                            ? 'border-brand-solid ring-2 ring-brand-soft'
                            : 'border-border-subtle',
                        )}
                        style={{ backgroundColor: color.hex }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-h3 font-bold text-text-price">
                {formatMoney(price, locale)}
              </span>
              {showCompareAt && product.compareAt ? (
                <span className="text-h6 text-text-muted line-through">
                  {formatMoney(product.compareAt, locale)}
                </span>
              ) : null}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                variant="outline"
                fullWidth
                disabled={!canBuy}
                onClick={() => {
                  addToCart();
                  router.push('/cart');
                }}
              >
                {t('common.buyNow')}
              </Button>
              <Button
                size="lg"
                fullWidth
                iconLeft={<ShoppingCart className="size-5" />}
                disabled={!canBuy}
                onClick={addToCart}
              >
                {canBuy ? t('common.addToCart') : t('product.outOfStock')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                aria-label={t('product.wishlist')}
                className="sm:w-12 sm:shrink-0 sm:px-0"
              >
                <Heart className="size-5" />
              </Button>
            </div>

            <p className="text-body-s text-text-muted">
              {t('product.soldBy')}{' '}
              <span className="font-medium text-text-primary">{product.vendorName}</span>
            </p>
          </div>
        </div>
      </Container>

      {/* Tabs */}
      <div className="border-y border-border-subtle">
        <Container>
          <div role="tablist" aria-label={product.title} className="flex gap-1">
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

      {/* Overview: spec table beside what's-in-box (only when the product has them) */}
      {tab === 'overview' && hasOverview ? (
        <div
          role="tabpanel"
          tabIndex={0}
          id={panelId('overview')}
          aria-labelledby={tabId('overview')}
        >
          <Container as="section" className="py-10">
            <div className="grid gap-10 md:grid-cols-2">
              {product.specs?.length ? (
                <div>
                  <h2 className="mb-4 font-heading text-h5 font-semibold text-text-primary">
                    {t('product.specs')}
                  </h2>
                  <dl className="flex flex-col">
                    {product.specs.map((spec) => (
                      <div
                        key={spec.label}
                        className="grid grid-cols-[120px_1fr] gap-4 border-b border-border-subtle py-3"
                      >
                        <dt className="text-body-m text-text-muted">{spec.label}</dt>
                        <dd className="text-body-m text-text-body">{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              {product.boxItems?.length ? (
                <div>
                  <h2 className="mb-4 font-heading text-h5 font-semibold text-text-primary">
                    {t('product.whatsInBox')}
                  </h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {product.boxItems.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-body-m text-text-body">
                        <Check className="size-4 text-success-fg" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Container>
        </div>
      ) : null}

      {/* Reviews: distribution + comments left, form right */}
      {tab === 'reviews' ? (
        <div
          role="tabpanel"
          tabIndex={0}
          id={panelId('reviews')}
          aria-labelledby={tabId('reviews')}
        >
          <Container as="section" className="py-10">
            <div className="mb-8 grid items-center gap-8 rounded-xl border border-border-subtle bg-bg-muted/30 p-6 sm:grid-cols-[200px_1fr]">
              <div className="flex flex-col items-center gap-1 text-center">
                <span className="text-h1 font-bold text-text-primary">{product.rating}</span>
                <StarRating value={product.rating} size="md" />
                <span className="text-body-s text-text-muted">
                  {t('product.of5')} · {product.reviewCount} {t('product.reviews')}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {dist.map(([star, pct]) => (
                  <div key={star} className="flex items-center gap-3">
                    <span className="w-6 text-body-s text-text-muted">{star}.0</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-muted">
                      <div
                        className="h-full rounded-full bg-success-solid"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-body-s text-text-muted">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
              {/* Comments */}
              <ul className="flex flex-col divide-y divide-border-faint">
                {reviews.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 py-5 first:pt-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-body-s font-semibold text-brand-text">
                          {r.author.charAt(0)}
                        </span>
                        <div>
                          <p className="text-body-m font-medium text-text-primary">{r.author}</p>
                          <span className="text-body-s text-text-muted">
                            {formatDate(r.date, locale)}
                          </span>
                        </div>
                      </div>
                      <StarRating value={r.rating} />
                    </div>
                    <p className="text-body-m text-text-body">{r.body}</p>
                    <div className="flex items-center gap-4 text-text-muted">
                      <button
                        type="button"
                        aria-label={t('product.helpful', { count: r.helpfulCount })}
                        className="inline-flex items-center gap-1 text-body-s hover:text-brand-text"
                      >
                        <ThumbsUp className="size-4" aria-hidden />
                        {formatCompact(r.helpfulCount, locale)}
                      </button>
                      <button
                        type="button"
                        aria-label={t('product.notHelpful', { count: r.notHelpfulCount })}
                        className="inline-flex items-center gap-1 text-body-s hover:text-brand-text"
                      >
                        <ThumbsDown className="size-4" aria-hidden />
                        {formatCompact(r.notHelpfulCount, locale)}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Write review form */}
              <Card className="flex h-fit flex-col gap-3 p-5">
                <h3 className="text-body-m font-semibold text-text-primary">
                  {t('product.addReview')}
                </h3>
                <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${ids}-review-name`}>{t('product.reviewName')}</Label>
                    <Input id={`${ids}-review-name`} name="name" autoComplete="name" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${ids}-review-email`}>{t('product.reviewEmail')}</Label>
                    <Input
                      id={`${ids}-review-email`}
                      name="email"
                      type="email"
                      autoComplete="email"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${ids}-review-body`}>{t('product.reviewBody')}</Label>
                    <Textarea id={`${ids}-review-body`} name="body" rows={3} />
                  </div>
                  <Button type="submit" size="md">
                    {t('product.addReview')}
                  </Button>
                </form>
              </Card>
            </div>
          </Container>
        </div>
      ) : null}

      {/* Related */}
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
