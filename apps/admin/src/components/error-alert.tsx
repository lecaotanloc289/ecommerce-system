import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@repo/ui';
import { errorMessage } from '@/lib/api-error';
import { useLocale } from '@/i18n/use-locale';

/** Shows any query/mutation error translated from its API `errorCode` + `params`. */
export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  const { locale } = useLocale();
  return (
    <Alert variant="danger" className={className}>
      <CircleAlert aria-hidden />
      <AlertDescription>{errorMessage(locale, error)}</AlertDescription>
    </Alert>
  );
}
