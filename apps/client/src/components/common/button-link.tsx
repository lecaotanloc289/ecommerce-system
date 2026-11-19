import Link from 'next/link';
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
 * next/link styled as a button. Preferred over `<Button asChild>` for navigation:
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
