import { useCurrentUser } from '@/auth/session';
import { PageHeader } from '@/components/page-header';
import { useT, type MessageKey } from '@/i18n/use-locale';

/** Portal landing page — empty until the portals ship their metrics. */
export function DashboardPage({ titleKey }: { titleKey: MessageKey }) {
  const t = useT();
  const user = useCurrentUser();
  return (
    <>
      <PageHeader
        title={t(titleKey)}
        description={t('admin.dashboard.welcome', { name: user.name })}
      />
      <div className="rounded-lg border border-border-subtle bg-bg-elevated px-6 py-12 text-center text-body-s text-text-muted">
        {t('admin.dashboard.placeholder')}
      </div>
    </>
  );
}
