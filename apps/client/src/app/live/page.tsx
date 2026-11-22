'use client';

import { Container } from '../../components/layout/container';
import { SectionHeading } from '../../components/common/section-heading';
import { LiveCard } from '../../components/live/live-card';
import { useT } from '../../i18n/locale-provider';
import { liveSessions, type MockLiveSession } from '../../mocks/live';

export default function LivePage() {
  const t = useT();
  const sections: { title: string; items: MockLiveSession[] }[] = [
    { title: t('live.sectionLive'), items: liveSessions.filter((s) => s.status === 'LIVE') },
    {
      title: t('live.sectionUpcoming'),
      items: liveSessions.filter((s) => s.status === 'SCHEDULED'),
    },
    { title: t('live.sectionReplays'), items: liveSessions.filter((s) => s.status === 'ENDED') },
  ].filter((s) => s.items.length > 0);

  return (
    <Container as="section" className="py-8 lg:py-12">
      <h1 className="mb-8 font-heading text-h3 font-bold tracking-tight text-text-primary lg:text-h2">
        {t('live.listTitle')}
      </h1>
      {sections.length === 0 ? (
        <p className="py-16 text-center text-body-l text-text-muted">{t('live.empty')}</p>
      ) : (
        sections.map((section) => (
          <div key={section.title} className="mb-10">
            <SectionHeading title={section.title} />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-6">
              {section.items.map((session) => (
                <LiveCard key={session.id} session={session} />
              ))}
            </div>
          </div>
        ))
      )}
    </Container>
  );
}
