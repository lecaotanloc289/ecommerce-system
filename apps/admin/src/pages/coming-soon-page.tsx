import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { useT, type MessageKey } from '@/i18n/use-locale';

/** Placeholder for portal pages not built yet (filled in by T5.3 vendor / T5.4 platform). */
export function ComingSoonPage({ titleKey }: { titleKey: MessageKey }) {
  const t = useT();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-default bg-bg-elevated px-6 py-16 text-center">
        <Construction className="size-8 text-text-muted" aria-hidden />
        <p className="text-body-m font-semibold text-text-primary">{t('admin.comingSoon.title')}</p>
        <p className="text-body-s text-text-muted">{t('admin.comingSoon.description')}</p>
      </div>
    </>
  );
}
