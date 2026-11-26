'use client';

// Client component: `buttonVariants` lives in @repo/ui's 'use client' button module, so it
// can't be called while rendering a Server Component (home page is an RSC).
import { Link } from '@/i18n/navigation';
import type { ComponentProps } from 'react';
import { buttonVariants } from '@repo/ui';
import { cn } from '../../lib/utils';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'outline'
  | 'link'
  | 'dark';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

/**
 * Locale-aware Link (`@/i18n/navigation`) styled as a button. Preferred over `<Button asChild>` for navigation:
 * the shared Button renders icon slots, so Radix Slot's single-child rule breaks.
 */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}) {
  return (
    <Link className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props} />
  );
}
