import { redirect } from '@/i18n/navigation';
import { pageLocale } from '@/i18n/page-locale';

/**
 * Order tracking lives on the order detail page (status timeline from the API). The old entry
 * point stays for the navbar / old links: `?orderId=` → that order, else the order list.
 */
export const dynamic = 'force-dynamic';

export default async function TrackOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ orderId?: string | string[] }>;
}) {
  const locale = await pageLocale(params);
  const { orderId } = await searchParams;
  const id = Array.isArray(orderId) ? orderId[0] : orderId;
  redirect({ href: id ? `/account/orders/${encodeURIComponent(id)}` : '/account/orders', locale });
}
