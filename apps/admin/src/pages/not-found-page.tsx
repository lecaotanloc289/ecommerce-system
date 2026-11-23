import { Link } from 'react-router';
import { buttonVariants } from '@repo/ui';
import { useT } from '@/i18n/use-locale';

/** 404 — rendered full-page at the root and inside each portal layout. */
export function NotFoundPage() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="font-heading text-h3 font-bold text-text-muted">404</p>
      <h1 className="font-heading text-h6 font-bold text-text-primary">
        {t('admin.notFound.title')}
      </h1>
      <p className="max-w-md text-body-s text-text-muted">{t('admin.notFound.description')}</p>
      <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
        {t('admin.notFound.backHome')}
      </Link>
    </div>
  );
}
