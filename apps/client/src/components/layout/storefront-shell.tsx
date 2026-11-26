import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import type { AppLocale } from '@repo/i18n';
import '@/app/globals.css';
import { AuthProvider } from '@/store/auth-provider';
import { CartProvider } from '@/store/cart-store';
import { CheckoutProvider } from '@/store/checkout-store';
import { AppearanceProvider } from '@/store/appearance-store';
import { SeasonalRibbon } from '@/components/seasonal/seasonal-ribbon';
import { Toaster } from '@repo/ui';
import { Navbar } from './navbar';
import { Footer } from './footer';

/**
 * Apply appearance (mode, accent, corners, text size) before first paint to avoid a flash
 * (DESIGN.md §2). Mirrors AppearanceProvider (store/appearance-store.tsx): reads the
 * `appearance` prefs, legacy `theme`, and the `appearance-accent` cache an `auto` accent
 * resolved to for a running event (honoured until its last day, Vietnam time = UTC+7).
 */
const noFlashScript = `(function(){try{var s=localStorage,r=document.documentElement,p={};try{p=JSON.parse(s.getItem('appearance')||'{}')||{}}catch(e){}var m=p.mode||s.getItem('theme')||'system';r.classList.toggle('dark',m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches));var A=['red','orange','green','teal','blue','purple'],a=p.accent;if(a!=='indigo'&&A.indexOf(a)<0){a=null;try{var c=JSON.parse(s.getItem('appearance-accent')||'null');var n=new Date(Date.now()+252e5).toISOString().slice(0,10);if(c&&c.until>=n)a=c.accent}catch(e){}}if(A.indexOf(a)>=0)r.setAttribute('data-accent',a);if(p.radius==='sharp'||p.radius==='round')r.setAttribute('data-radius',p.radius);if(p.fontScale==='sm'||p.fontScale==='lg')r.setAttribute('data-font-scale',p.fontScale);}catch(e){}})();`;

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
          <AppearanceProvider>
            <AuthProvider>
              <CartProvider>
                <CheckoutProvider>
                  <Navbar />
                  <SeasonalRibbon />
                  <main className="flex-1">{children}</main>
                  <Footer />
                  <Toaster />
                </CheckoutProvider>
              </CartProvider>
            </AuthProvider>
          </AppearanceProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
