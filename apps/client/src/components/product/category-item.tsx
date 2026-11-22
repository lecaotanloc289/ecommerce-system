import { Link } from '@/i18n/navigation';
import type { Category } from '@repo/core';
import { cn } from '../../lib/utils';

/**
 * Category tile (Parts/Category Item/001): monogram + localized name, linking to the category
 * page. Categories have no image/icon in the API yet, hence the initial. Server-safe.
 */
export function CategoryItem({
  category,
  className,
}: {
  category: Pick<Category, 'name' | 'slug'>;
  className?: string;
}) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className={cn(
        'group flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-bg-elevated p-4 text-center transition-shadow hover:shadow-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-brand-soft font-heading text-h5 font-bold text-brand-text transition-transform group-hover:scale-105"
      >
        {category.name.charAt(0).toUpperCase()}
      </span>
      <span className="text-body-m font-medium text-text-primary">{category.name}</span>
    </Link>
  );
}
