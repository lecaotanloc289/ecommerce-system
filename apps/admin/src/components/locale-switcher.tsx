import { APP_LOCALES, isAppLocale, type AppLocale } from '@repo/i18n';
import { cn } from '@repo/ui';
import { useLocale, type MessageKey } from '@/i18n/use-locale';

const LABEL_KEYS: Readonly<Record<AppLocale, MessageKey>> = {
  vi: 'admin.locale.vi',
  en: 'admin.locale.en',
};

/** vi/en select. The choice is applied instantly and remembered (see `use-locale.ts`). */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      value={locale}
      onChange={(e) => {
        if (isAppLocale(e.target.value)) setLocale(e.target.value);
      }}
      aria-label={t('common.selectLanguage')}
      className={cn(
        'h-9 cursor-pointer rounded-md border border-border-default bg-bg-elevated px-2 text-body-s font-medium text-text-body',
        'transition-colors hover:bg-bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        className,
      )}
    >
      {APP_LOCALES.map((value) => (
        <option key={value} value={value}>
          {t(LABEL_KEYS[value])}
        </option>
      ))}
    </select>
  );
}
