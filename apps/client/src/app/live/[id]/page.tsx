import { notFound } from 'next/navigation';
import { LiveWatch } from '../../../components/live/live-watch';
import { getLiveSession, liveSessions } from '../../../mocks/live';

/** Pre-render every mock session id for the static export. */
export function generateStaticParams() {
  return liveSessions.map((s) => ({ id: s.id }));
}

export default async function LiveSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getLiveSession(id);
  if (!session) notFound();
  return <LiveWatch session={session} />;
}
