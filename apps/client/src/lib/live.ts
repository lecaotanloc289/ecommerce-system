import type { AppLocale } from '@repo/i18n';

/** Date + time with zone for schedule labels (the shared formatters are date-only). */
export function formatDateTime(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
}
