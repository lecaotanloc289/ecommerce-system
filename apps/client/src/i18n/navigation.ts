import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware replacements for `next/link` / `next/navigation`. Pass locale-less paths
 * (`/cart`, `/product/x`); the current locale prefix is added automatically.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
