import { z } from 'zod';
import {
  fromJulianDay,
  lunarToSolar,
  toJulianDay,
  VIETNAM_UTC_OFFSET_HOURS,
  type CalendarDate,
} from './lunar';

/**
 * Yearly marketing calendar: Vietnamese public holidays, lunar festivals, gift-giving days and
 * e-commerce mega-sales the storefront re-themes for. WHEN each event happens lives here;
 * names/copy live in `@repo/i18n` (`events.<id>.*`), visuals in each app.
 *
 * Solemn remembrance days (3/2, 27/7, 22/12) are intentionally absent: a sales theme there
 * would be inappropriate.
 */
export const SEASONAL_EVENT_IDS = [
  'new-year',
  'lunar-new-year',
  'lantern-festival',
  'valentines-day',
  'womens-day',
  'hung-kings',
  'reunification-day',
  'mothers-day',
  'childrens-day',
  'dragon-boat',
  'fathers-day',
  'family-day',
  'vu-lan',
  'national-day',
  'mid-autumn',
  'vietnamese-womens-day',
  'halloween',
  'singles-day',
  'teachers-day',
  'black-friday',
  'double-twelve',
  'christmas',
] as const;

export const SeasonalEventIdSchema = z.enum(SEASONAL_EVENT_IDS);
export type SeasonalEventId = z.infer<typeof SeasonalEventIdSchema>;

export type SeasonalDateRule =
  /** Fixed Gregorian date. */
  | { readonly kind: 'solar'; readonly month: number; readonly day: number }
  /** Fixed Vietnamese lunar date (never a leap month). */
  | { readonly kind: 'lunar'; readonly month: number; readonly day: number }
  /** n-th `weekday` (0 = Sunday) of a Gregorian month, shifted by `offsetDays`. */
  | {
      readonly kind: 'nth-weekday';
      readonly month: number;
      readonly weekday: number;
      readonly n: number;
      readonly offsetDays?: number;
    };

export interface SeasonalEventDefinition {
  readonly id: SeasonalEventId;
  readonly rule: SeasonalDateRule;
  /** Days before the main day the theme switches on (the shopping run-up). */
  readonly leadDays: number;
  /** Days after the main day the theme stays on. */
  readonly trailDays: number;
  /** When windows overlap the higher priority wins; ties go to the nearer main day. */
  readonly priority: number;
}

export const SEASONAL_EVENTS: readonly SeasonalEventDefinition[] = [
  {
    id: 'new-year',
    rule: { kind: 'solar', month: 1, day: 1 },
    leadDays: 4,
    trailDays: 1,
    priority: 80,
  },
  // Window opens three weeks early for the "sắm Tết" run-up (covers Ông Công Ông Táo, 23 Chạp)
  // and runs to mùng 7.
  {
    id: 'lunar-new-year',
    rule: { kind: 'lunar', month: 1, day: 1 },
    leadDays: 21,
    trailDays: 6,
    priority: 100,
  },
  {
    id: 'lantern-festival',
    rule: { kind: 'lunar', month: 1, day: 15 },
    leadDays: 2,
    trailDays: 0,
    priority: 70,
  },
  {
    id: 'valentines-day',
    rule: { kind: 'solar', month: 2, day: 14 },
    leadDays: 7,
    trailDays: 0,
    priority: 60,
  },
  {
    id: 'womens-day',
    rule: { kind: 'solar', month: 3, day: 8 },
    leadDays: 6,
    trailDays: 0,
    priority: 80,
  },
  {
    id: 'hung-kings',
    rule: { kind: 'lunar', month: 3, day: 10 },
    leadDays: 3,
    trailDays: 0,
    priority: 85,
  },
  // 30/4 Reunification Day + 1/5 Labour Day run as one long weekend.
  {
    id: 'reunification-day',
    rule: { kind: 'solar', month: 4, day: 30 },
    leadDays: 6,
    trailDays: 1,
    priority: 90,
  },
  {
    id: 'mothers-day',
    rule: { kind: 'nth-weekday', month: 5, weekday: 0, n: 2 },
    leadDays: 6,
    trailDays: 0,
    priority: 70,
  },
  {
    id: 'childrens-day',
    rule: { kind: 'solar', month: 6, day: 1 },
    leadDays: 6,
    trailDays: 0,
    priority: 80,
  },
  {
    id: 'dragon-boat',
    rule: { kind: 'lunar', month: 5, day: 5 },
    leadDays: 2,
    trailDays: 0,
    priority: 75,
  },
  {
    id: 'fathers-day',
    rule: { kind: 'nth-weekday', month: 6, weekday: 0, n: 3 },
    leadDays: 6,
    trailDays: 0,
    priority: 70,
  },
  {
    id: 'family-day',
    rule: { kind: 'solar', month: 6, day: 28 },
    leadDays: 3,
    trailDays: 0,
    priority: 65,
  },
  {
    id: 'vu-lan',
    rule: { kind: 'lunar', month: 7, day: 15 },
    leadDays: 7,
    trailDays: 0,
    priority: 75,
  },
  {
    id: 'national-day',
    rule: { kind: 'solar', month: 9, day: 2 },
    leadDays: 5,
    trailDays: 1,
    priority: 90,
  },
  {
    id: 'mid-autumn',
    rule: { kind: 'lunar', month: 8, day: 15 },
    leadDays: 14,
    trailDays: 1,
    priority: 85,
  },
  {
    id: 'vietnamese-womens-day',
    rule: { kind: 'solar', month: 10, day: 20 },
    leadDays: 6,
    trailDays: 0,
    priority: 80,
  },
  {
    id: 'halloween',
    rule: { kind: 'solar', month: 10, day: 31 },
    leadDays: 7,
    trailDays: 0,
    priority: 60,
  },
  {
    id: 'singles-day',
    rule: { kind: 'solar', month: 11, day: 11 },
    leadDays: 2,
    trailDays: 0,
    priority: 80,
  },
  {
    id: 'teachers-day',
    rule: { kind: 'solar', month: 11, day: 20 },
    leadDays: 7,
    trailDays: 0,
    priority: 90,
  },
  // Friday after the 4th Thursday of November; trails through Cyber Monday.
  {
    id: 'black-friday',
    rule: { kind: 'nth-weekday', month: 11, weekday: 4, n: 4, offsetDays: 1 },
    leadDays: 7,
    trailDays: 3,
    priority: 80,
  },
  {
    id: 'double-twelve',
    rule: { kind: 'solar', month: 12, day: 12 },
    leadDays: 2,
    trailDays: 0,
    priority: 80,
  },
  {
    id: 'christmas',
    rule: { kind: 'solar', month: 12, day: 25 },
    leadDays: 14,
    trailDays: 1,
    priority: 70,
  },
];

export interface SeasonalEventOccurrence {
  readonly id: SeasonalEventId;
  /** The holiday itself. */
  readonly date: CalendarDate;
  /** First and last day (inclusive) the theme is on. */
  readonly start: CalendarDate;
  readonly end: CalendarDate;
  readonly priority: number;
}

export interface ActiveSeasonalEvent extends SeasonalEventOccurrence {
  /** Days from today to the main day: >0 run-up, 0 today, <0 after. */
  readonly daysUntil: number;
}

/** Today's date in Vietnam (UTC+7), whatever the device's own timezone. */
export function vietnamToday(now: Date): CalendarDate {
  const shifted = new Date(now.getTime() + VIETNAM_UTC_OFFSET_HOURS * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return toJulianDay(b) - toJulianDay(a);
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromJulianDay(toJulianDay(date) + days);
}

/** 0 = Sunday … 6 = Saturday. */
function weekdayOf(date: CalendarDate): number {
  return (toJulianDay(date) + 1) % 7;
}

function resolveRule(rule: SeasonalDateRule, year: number): CalendarDate {
  switch (rule.kind) {
    case 'solar':
      return { year, month: rule.month, day: rule.day };
    case 'lunar': {
      const date = lunarToSolar({ year, month: rule.month, day: rule.day });
      // Only `leap: true` can return null, and rules never set it.
      if (!date) throw new Error(`unresolvable lunar date ${rule.day}/${rule.month}/${year}`);
      return date;
    }
    case 'nth-weekday': {
      const first = { year, month: rule.month, day: 1 };
      const shift = (rule.weekday - weekdayOf(first) + 7) % 7;
      return addDays(first, shift + 7 * (rule.n - 1) + (rule.offsetDays ?? 0));
    }
  }
}

/** Where `event` falls in `year` (by the main day's year). */
export function getSeasonalOccurrence(
  event: SeasonalEventDefinition,
  year: number,
): SeasonalEventOccurrence {
  const date = resolveRule(event.rule, year);
  return {
    id: event.id,
    date,
    start: addDays(date, -event.leadDays),
    end: addDays(date, event.trailDays),
    priority: event.priority,
  };
}

/** Every event of `year`, sorted by main day. */
export function getSeasonalCalendar(
  year: number,
  events: readonly SeasonalEventDefinition[] = SEASONAL_EVENTS,
): SeasonalEventOccurrence[] {
  return events
    .map((e) => getSeasonalOccurrence(e, year))
    .sort((a, b) => toJulianDay(a.date) - toJulianDay(b.date));
}

/** Occurrences of the years around `today`, so windows crossing New Year are not missed. */
function nearbyOccurrences(
  today: CalendarDate,
  events: readonly SeasonalEventDefinition[],
): SeasonalEventOccurrence[] {
  return [today.year - 1, today.year, today.year + 1].flatMap((y) =>
    getSeasonalCalendar(y, events),
  );
}

/**
 * Every event whose window contains `today`, best first (priority, then nearest main day).
 * The first entry is the one the storefront themes for.
 */
export function getActiveSeasonalEvents(
  today: CalendarDate,
  events: readonly SeasonalEventDefinition[] = SEASONAL_EVENTS,
): ActiveSeasonalEvent[] {
  const now = toJulianDay(today);
  return nearbyOccurrences(today, events)
    .filter((o) => toJulianDay(o.start) <= now && now <= toJulianDay(o.end))
    .map((o) => ({ ...o, daysUntil: toJulianDay(o.date) - now }))
    .sort((a, b) => b.priority - a.priority || Math.abs(a.daysUntil) - Math.abs(b.daysUntil));
}

/** The event to theme for on `today`, or null between seasons. */
export function getActiveSeasonalEvent(
  today: CalendarDate,
  events: readonly SeasonalEventDefinition[] = SEASONAL_EVENTS,
): ActiveSeasonalEvent | null {
  return getActiveSeasonalEvents(today, events)[0] ?? null;
}

/** The next `limit` events whose window has not opened yet, soonest first. */
export function getUpcomingSeasonalEvents(
  today: CalendarDate,
  limit: number,
  events: readonly SeasonalEventDefinition[] = SEASONAL_EVENTS,
): ActiveSeasonalEvent[] {
  const now = toJulianDay(today);
  return nearbyOccurrences(today, events)
    .filter((o) => toJulianDay(o.start) > now)
    .sort((a, b) => toJulianDay(a.start) - toJulianDay(b.start))
    .slice(0, limit)
    .map((o) => ({ ...o, daysUntil: toJulianDay(o.date) - now }));
}

/** ISO `YYYY-MM-DD` — handy as a stable key and for `<time dateTime>`. */
export function toIsoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
