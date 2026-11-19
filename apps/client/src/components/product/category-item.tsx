'use client';

import Link from 'next/link';
import { useT } from '../../i18n/locale-provider';
import { cn } from '../../lib/utils';
import type { Category } from '../../types';

/** Compact icon tile (Parts/Category Item/001). Used in the Home category row. */
export function CategoryItem({ category, className }: { category: Category; className?: string }) {
  const t = useT();
  return (
    <Link
      href={`/search?category=${category.slug}`}
      className={cn(
        'group flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-bg-elevated p-4 text-center transition-shadow hover:shadow-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        className,
      )}
    >
      <span className="flex size-16 items-center justify-center rounded-full bg-brand-soft text-2xl transition-transform group-hover:scale-105">
        {category.icon}
      </span>
      <span className="text-body-m font-medium text-text-primary">{category.name}</span>
      <span className="text-body-s text-text-muted">
        {t('categories.productsCount', { count: category.productCount })}
      </span>
    </Link>
  );
}
