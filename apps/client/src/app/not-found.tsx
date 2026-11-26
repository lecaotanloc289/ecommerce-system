import { getLocale } from 'next-intl/server';
import { NotFoundContent } from '@/components/common/not-found-content';
import { StorefrontShell } from '@/components/layout/storefront-shell';

/**
 * 404 for a full page load. Next renders a `notFound()` thrown during SSR (product slug,
 * unknown `/[locale]/...` path) through this root boundary, outside `[locale]/layout.tsx`,
 * so it re-creates the storefront shell. The locale comes from the next-intl middleware
 * (falls back to `vi` for paths the middleware skips).
 */
export default async function GlobalNotFound() {
  const locale = await getLocale();
  return (
    <StorefrontShell locale={locale}>
      <NotFoundContent />
    </StorefrontShell>
  );
}
