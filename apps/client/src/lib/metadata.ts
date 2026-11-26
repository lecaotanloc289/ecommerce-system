import type { Metadata } from 'next';

const DESCRIPTION_MAX = 160;

/** Collapse whitespace and cut at a word boundary for `<meta name="description">`. */
export function metaDescription(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= DESCRIPTION_MAX) return flat || undefined;
  const cut = flat.slice(0, DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Title + description + Open Graph (image when there is one) for a catalog page. */
export function catalogMetadata({
  title,
  description,
  image,
  type = 'website',
}: {
  title: string;
  description?: string | null | undefined;
  image?: string | null | undefined;
  type?: 'website' | 'article';
}): Metadata {
  const desc = metaDescription(description);
  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type,
      images: image ? [{ url: image }] : undefined,
    },
  };
}
