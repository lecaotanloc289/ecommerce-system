import { Loader2 } from 'lucide-react';
import { useT, type MessageKey } from '@/i18n/use-locale';

/** Full-screen loading state (session restore at boot, OAuth callback). */
export function Splash({ messageKey = 'admin.splash.restoring' }: { messageKey?: MessageKey }) {
  const t = useT();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg-page text-text-muted"
    >
      <span className="font-heading text-h5 font-bold text-text-primary">{t('admin.appName')}</span>
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <span className="text-body-s">{t(messageKey)}</span>
    </div>
  );
}
