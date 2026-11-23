import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Both entries must be literals (statically analysed by Next).
  matcher: [
    // Every locale-prefixed path, even one containing a dot (e.g. a product slug `x-4.5`).
    // Keep in sync with APP_LOCALES.
    '/(vi|en)/:path*',
    // Every other path except API routes, Next/Vercel internals and real static files. Only a
    // known asset extension at the END of the path is skipped — a bare `/product/x-4.5` still
    // gets the locale redirect.
    '/((?!(?:api|_next|_vercel)(?:/|$))(?!.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff2?|ttf|otf|pdf)$).*)',
  ],
};
