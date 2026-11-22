import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import type { AppLocale } from '@repo/i18n';
import '@/app/globals.css';
import { AuthProvider } from '@/store/auth-provider';
import { CartProvider } from '@/store/cart-store';
import { CheckoutProvider } from '@/store/checkout-store';
import { Navbar } from './navbar';
import { Footer } from './footer';

/** Set theme before first paint to avoid a flash (DESIGN.md §2). */
const noFlashScript = `(function(){try{var t=localStorage.theme;var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

/**
 * The storefront document: `<html lang>`, fonts, client providers, navbar + footer.
 * Used by `app/[locale]/layout.tsx` and by `app/not-found.tsx` (Next renders a 404 thrown
 * during SSR through the root not-found, outside the locale layout).
 */
export function StorefrontShell({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        {/* Elma design system fonts — Rubik (heading) + Roboto (body). See DESIGN.md §4.
            Inter (vietnamese subset) overrides both for lang="vi" — full Vietnamese
            diacritic coverage; see globals.css html[lang='vi']. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Roboto:wght@400;500;700&family=Inter:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-screen flex-col bg-bg-page text-text-body antialiased">
        {/* Locale only: text is translated with @repo/i18n's createTranslator (useT/useLocale),
            so next-intl gets no message catalog. */}
        <NextIntlClientProvider locale={locale} messages={null}>
          <AuthProvider>
            <CartProvider>
              <CheckoutProvider>
                <Navbar />
                <main className="flex-1">{children}</main>
                <Footer />
              </CheckoutProvider>
            </CartProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
