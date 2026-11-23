import { Button } from '@repo/ui';
import { CenteredCard } from '@/components/centered-card';
import { useT } from '@/i18n/use-locale';

/** Router `errorElement`: a render error or a thrown loader error anywhere in the tree. */
export function RouteErrorPage() {
  const t = useT();
  return (
    <CenteredCard
      title={t('admin.routeError.title')}
      description={t('admin.routeError.description')}
    >
      <Button fullWidth onClick={() => window.location.reload()}>
        {t('admin.routeError.reload')}
      </Button>
    </CenteredCard>
  );
}
