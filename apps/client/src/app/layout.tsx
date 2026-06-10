import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Ecommerce',
  description: 'Multi-vendor marketplace',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <head>
        {/* Elma design system fonts — Rubik (heading) + Roboto (body).
         * tokens.css references these literal family names; load them here.
         * See DESIGN.md §4. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700&family=Roboto:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
