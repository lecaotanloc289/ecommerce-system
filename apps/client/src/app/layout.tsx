import type { ReactNode } from 'react';

/**
 * Pass-through: the real root layout (`<html lang>`, providers) is `[locale]/layout.tsx`.
 * This file exists only so `app/not-found.tsx` (which renders its own shell) has a root.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
