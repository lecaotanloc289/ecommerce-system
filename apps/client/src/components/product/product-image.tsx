import { ImageOff } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Product / vendor image that tolerates a missing URL (`primaryImageUrl`, `logoUrl` and
 * `imageUrl` are nullable in the API): renders a neutral placeholder tile instead.
 * Server-safe (no hooks) so RSC pages can use it directly.
 */
export function ProductImage({
  src,
  alt,
  className,
  loading = 'lazy',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}) {
  if (!src) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn('flex items-center justify-center bg-bg-muted text-text-disabled', className)}
      >
        <ImageOff className="size-1/4 max-h-10 max-w-10" aria-hidden />
      </span>
    );
  }
  return <img src={src} alt={alt} className={cn('object-cover', className)} loading={loading} />;
}
