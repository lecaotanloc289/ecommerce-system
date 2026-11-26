import { notFound } from 'next/navigation';
import { LiveWatch } from '@/components/live/live-watch';
import { pageLocale } from '@/i18n/page-locale';
import { getLiveSession, liveSessions } from '@/mocks/live';

/** Prerender every mock session id (the locale comes from `[locale]/layout.tsx`). */
export function generateStaticParams() {
  return liveSessions.map((s) => ({ id: s.id }));
}

export default async function LiveSessionPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  await pageLocale(params);
  const { id } = await params;
  const session = getLiveSession(id);
  if (!session) notFound();
  return <LiveWatch session={session} />;
}
