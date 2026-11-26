import { SEASONAL_EVENTS, toIsoDate, type CalendarDate, type SeasonalEventId } from '@repo/core';
import { formatDate, type AppLocale, type TFunction } from '@repo/i18n';

/** A VN calendar day formatted like other dates in the store ("25 thg 9, 2026"). */
export function formatCalendarDate(date: CalendarDate, locale: AppLocale): string {
  // Noon VN time: formatDate renders in Asia/Ho_Chi_Minh, so the day can never shift.
  return formatDate(`${toIsoDate(date)}T12:00:00+07:00`, locale);
}

/** "Today" / "Tomorrow" / "4 days to go" / "Until 30 Nov" for an event relative to today. */
export function countdownLabel(
  daysUntil: number,
  end: CalendarDate,
  locale: AppLocale,
  t: TFunction,
): string {
  if (daysUntil === 0) return t('seasonal.today');
  if (daysUntil === 1) return t('seasonal.tomorrow');
  if (daysUntil > 1) return t('seasonal.daysLeft', { days: daysUntil });
  return t('seasonal.endsOn', { date: formatCalendarDate(end, locale) });
}

/** "Lunar 15/8" for lunar-dated events, null otherwise. */
export function lunarLabel(id: SeasonalEventId, t: TFunction): string | null {
  const rule = SEASONAL_EVENTS.find((e) => e.id === id)?.rule;
  return rule?.kind === 'lunar'
    ? t('seasonal.lunarDate', { day: rule.day, month: rule.month })
    : null;
}
