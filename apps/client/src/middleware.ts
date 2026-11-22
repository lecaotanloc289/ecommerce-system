import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Every locale-prefixed path, even one containing a dot (e.g. a product slug `x-4.5`).
    // Must be a literal (statically analysed); keep in sync with APP_LOCALES.
    '/(vi|en)/:path*',
    // Everything else except API routes, Next internals and files with an extension (assets).
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
