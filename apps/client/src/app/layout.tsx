import type { ReactNode } from 'react';
import './globals.css';
import { LocaleProvider } from '../i18n/locale-provider';
import { en } from '../i18n/messages/en';
import { CartProvider } from '../store/cart-store';
import { CheckoutProvider } from '../store/checkout-store';
import { Navbar } from '../components/layout/navbar';
import { Footer } from '../components/layout/footer';

// Static export can't vary <head> per runtime locale, so metadata uses the en catalogue.
export const metadata = {
  title: en.meta.title,
  description: en.meta.description,
};

/** Set theme + lang before first paint to avoid a flash (DESIGN.md §2). */
const noFlashScript = `(function(){try{var t=localStorage.theme;var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);var l=localStorage.locale;if(l==='vi'||l==='en')document.documentElement.lang=l;}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
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
        <LocaleProvider>
          <CartProvider>
            <CheckoutProvider>
              <Navbar />
              <main className="flex-1">{children}</main>
              <Footer />
            </CheckoutProvider>
          </CartProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
