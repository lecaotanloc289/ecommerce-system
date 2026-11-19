'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Heart, ShoppingCart, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  Button,
  Card,
  Input,
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
import { formatMoney, formatDate } from '../../lib/format';
import { cn } from '../../lib/utils';
import { products, reviews } from '../../mocks/products';
import type { Product } from '../../types';

const TABS = ['overview', 'reviews', 'related'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, MessageKey> = {
  overview: 'product.overview',
  reviews: 'product.reviews',
  related: 'product.related',
};

const specs: [string, string][] = [
  ['Brand', 'Sony A7 Mark II'],
  ['Resolution', '42MP Full-frame R-CMOS Sensor'],
  ['Video', 'UHD 4K30p Video with HLG & S-Log2 Gamma'],
  ['Screen', '3.0in 144 Tru-Finder OLED EVF'],
];
const boxItems = [
  'Body (Body Only)',
  'BC-QZ1 Battery Charger',
  'Lithium-Ion Battery',
  'Cable (Protector)',
  'Shoulder Strap',
  'Accessory Shoe Cap',
  'Eyepiece Cup',
  'USB Type-C Cable',
];
const dist: [number, number][] = [
  [5, 88],
  [4, 64],
  [3, 24],
  [2, 8],
  [1, 4],
];

export function ProductDetail({ product }: { product: Product }) {
  const { locale, t } = useLocale();
  const [activeImage, setActiveImage] = React.useState(0);
  const [activeColor, setActiveColor] = React.useState(0);
  const [tab, setTab] = React.useState<Tab>('overview');
  const related = products
    .filter((p) => p.categorySlug === product.categorySlug && p.id !== product.id)
    .slice(0, 4);
  const colorNames = ['Original', 'Black', 'One'];

  return (
    <div className="flex flex-col">
      <Container className="py-6 lg:py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-body-s text-text-muted">
          <Link href="/" className="hover:text-brand-text">
            {t('common.home')}
          </Link>
          <span>/</span>
          <Link
            href={`/search?category=${product.categorySlug}`}
            className="capitalize hover:text-brand-text"
          >
            {product.categorySlug}
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
                    aria-label={`View image ${i + 1}`}
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

            <p className="text-body-m text-text-muted">
              {product.title} is a camera system that expands upon the latest imaging technologies.{' '}
              <button type="button" className="font-medium text-brand-text hover:underline">
                {t('common.viewAll')}
              </button>
            </p>

            {/* Type / Quantity / Color */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-body-s text-text-muted">Type</span>
                <Select defaultValue={product.variants?.[0]?.label ?? 'Standard'}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(product.variants ?? [{ id: 'std', label: 'Standard' }]).map((v) => (
                      <SelectItem key={v.id} value={v.label}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-body-s text-text-muted">{t('product.quantity')}</span>
                <QuantityStepper />
              </div>
              {product.colors ? (
                <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                  <span className="text-body-s text-text-muted">{t('product.color')}</span>
                  <div className="flex gap-2">
                    {product.colors.map((color, i) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setActiveColor(i)}
                        aria-label={colorNames[i] ?? `Color ${i + 1}`}
                        title={colorNames[i]}
                        className={cn(
                          'size-9 rounded-full border-2 transition',
                          i === activeColor
                            ? 'border-brand-solid ring-2 ring-brand-soft'
                            : 'border-border-subtle',
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-baseline gap-3">
              <span className="text-h3 font-bold text-text-price">
                {formatMoney(product.price, locale)}
              </span>
              {product.compareAt ? (
                <span className="text-h6 text-text-muted line-through">
                  {formatMoney(product.compareAt, locale)}
                </span>
              ) : null}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" variant="outline" fullWidth disabled={!product.inStock}>
                {t('common.buyNow')}
              </Button>
              <Button
                size="lg"
                fullWidth
                iconLeft={<ShoppingCart className="size-5" />}
                disabled={!product.inStock}
              >
                {t('common.addToCart')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                aria-label="Wishlist"
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
          <div className="flex gap-1">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'relative px-4 py-4 text-body-m font-medium transition-colors',
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

      {/* Overview: spec table beside what's-in-box */}
      {tab === 'overview' ? (
        <Container as="section" className="py-10">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <h2 className="mb-4 font-heading text-h5 font-semibold text-text-primary">
                {t('product.overview')}
              </h2>
              <dl className="flex flex-col">
                {specs.map(([k, v]) => (
                  <div
                    key={k}
                    className="grid grid-cols-[120px_1fr] gap-4 border-b border-border-subtle py-3"
                  >
                    <dt className="text-body-m text-text-muted">{k}</dt>
                    <dd className="text-body-m text-text-body">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h2 className="mb-4 font-heading text-h5 font-semibold text-text-primary">
                {t('product.whatsInBox')}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {boxItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-body-m text-text-body">
                    <Check className="size-4 text-success-fg" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      ) : null}

      {/* Reviews: distribution + comments left, form right */}
      {tab === 'reviews' ? (
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
                      className="inline-flex items-center gap-1 text-body-s hover:text-brand-text"
                    >
                      <ThumbsUp className="size-4" /> 1.2k
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-body-s hover:text-brand-text"
                    >
                      <ThumbsDown className="size-4" /> 84
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
              <Input placeholder={t('checkout.fullName')} aria-label="Your name" />
              <Input placeholder={t('checkout.email')} aria-label="Your email" type="email" />
              <Textarea placeholder="…" rows={3} aria-label="Review body" />
              <Button size="md">{t('product.addReview')}</Button>
            </Card>
          </div>
        </Container>
      ) : null}

      {/* Related */}
      {tab === 'related' || tab === 'overview' || tab === 'reviews' ? (
        <Container as="section" className="py-8 pb-16">
          <SectionHeading title={t('product.related')} />
          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </Container>
      ) : null}
    </div>
  );
}
