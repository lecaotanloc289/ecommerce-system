import { notFound } from 'next/navigation';

/** Unknown path under a valid locale → the localized `[locale]/not-found.tsx`. */
export default function CatchAllPage() {
  notFound();
}
