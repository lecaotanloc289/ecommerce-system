import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Ecommerce',
  description: 'Multi-vendor marketplace',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
