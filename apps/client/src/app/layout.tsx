import type { ReactNode } from 'react';
import './globals.css';
import { LocaleProvider } from '../i18n/locale-provider';
import { en } from '@repo/i18n';
import { CartProvider } from '../store/cart-store';
import { CheckoutProvider } from '../store/checkout-store';
import { AppearanceProvider } from '../store/appearance-store';
import { SeasonalRibbon } from '../components/seasonal/seasonal-ribbon';
import { Navbar } from '../components/layout/navbar';
import { Footer } from '../components/layout/footer';

// Static export can't vary <head> per runtime locale, so metadata uses the en catalogue.
export const metadata = {
  title: en.meta.title,
  description: en.meta.description,
};

/**
 * Apply appearance (mode, accent, corners, text size) + lang before first paint to avoid a
 * flash (DESIGN.md §2). Mirrors AppearanceProvider (store/appearance-store.tsx): reads the
 * `appearance` prefs, legacy `theme`, and the `appearance-accent` cache an `auto` accent
 * resolved to for a running event (honoured until its last day, Vietnam time = UTC+7).
 */
const noFlashScript = `(function(){try{var s=localStorage,r=document.documentElement,p={};try{p=JSON.parse(s.getItem('appearance')||'{}')||{}}catch(e){}var m=p.mode||s.getItem('theme')||'system';r.classList.toggle('dark',m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches));var A=['red','orange','green','teal','blue','purple'],a=p.accent;if(a!=='indigo'&&A.indexOf(a)<0){a=null;try{var c=JSON.parse(s.getItem('appearance-accent')||'null');var n=new Date(Date.now()+252e5).toISOString().slice(0,10);if(c&&c.until>=n)a=c.accent}catch(e){}}if(A.indexOf(a)>=0)r.setAttribute('data-accent',a);if(p.radius==='sharp'||p.radius==='round')r.setAttribute('data-radius',p.radius);if(p.fontScale==='sm'||p.fontScale==='lg')r.setAttribute('data-font-scale',p.fontScale);var l=s.getItem('locale');if(l==='vi'||l==='en')r.lang=l;}catch(e){}})();`;

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
          <AppearanceProvider>
            <CartProvider>
              <CheckoutProvider>
                <Navbar />
                <SeasonalRibbon />
                <main className="flex-1">{children}</main>
                <Footer />
              </CheckoutProvider>
            </CartProvider>
          </AppearanceProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
