import { brands } from '../../mocks/categories';
import { cn } from '../../lib/utils';

/** Tint backgrounds for the boxed brand grid (kit shows each brand on a colored tile). */
const tints = [
  'bg-tint-blue',
  'bg-tint-orange',
  'bg-tint-green',
  'bg-tint-indigo',
  'bg-tint-pink',
  'bg-tint-yellow',
  'bg-tint-teal',
  'bg-tint-purple',
];

/**
 * Brand logo strip (Elements/Brand Logo). `boxed` renders colored tiles (Shop
 * Categories page); otherwise a muted grayscale strip (Home). Real SVG assets land later.
 */
export function BrandLogoRow({
  boxed = false,
  className,
}: {
  boxed?: boolean;
  className?: string;
}) {
  if (boxed) {
    return (
      <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-4', className)}>
        {brands.slice(0, 8).map((brand, i) => (
          <div
            key={brand.id}
            className={cn(
              'flex h-28 items-center justify-center rounded-lg transition-shadow hover:shadow-1',
              tints[i % tints.length],
            )}
          >
            <span className="font-heading text-h5 font-bold text-text-primary">{brand.name}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-3 items-center gap-4 sm:grid-cols-6', className)}>
      {brands.slice(0, 6).map((brand) => (
        <div
          key={brand.id}
          className="flex h-12 items-center justify-center opacity-50 grayscale transition hover:opacity-100 hover:grayscale-0"
        >
          <span className="font-heading text-h6 font-bold text-text-muted">{brand.name}</span>
        </div>
      ))}
    </div>
  );
}
