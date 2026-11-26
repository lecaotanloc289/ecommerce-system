import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  fromJulianDay,
  getActiveSeasonalEvent,
  getActiveSeasonalEvents,
  getSeasonalCalendar,
  getSeasonalOccurrence,
  getUpcomingSeasonalEvents,
  lunarToSolar,
  SEASONAL_EVENT_IDS,
  SEASONAL_EVENTS,
  SeasonalEventIdSchema,
  toIsoDate,
  toJulianDay,
  vietnamToday,
  type CalendarDate,
  type SeasonalEventId,
} from '../src/calendar';

const d = (iso: string): CalendarDate => {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(iso);
  return { year, month, day };
};

const solar = (year: number, month: number, day: number, leap = false): string | null => {
  const date = lunarToSolar({ year, month, day, leap });
  return date ? toIsoDate(date) : null;
};

function occurrence(id: SeasonalEventId, year: number) {
  const def = SEASONAL_EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(id);
  return getSeasonalOccurrence(def, year);
}

describe('julian day', () => {
  it('round-trips Gregorian dates', () => {
    for (const iso of ['2000-01-01', '2024-02-29', '2026-11-23', '2099-12-31']) {
      expect(toIsoDate(fromJulianDay(toJulianDay(d(iso))))).toBe(iso);
    }
  });

  it('counts days across month and year ends', () => {
    expect(daysBetween(d('2026-12-31'), d('2027-01-01'))).toBe(1);
    expect(daysBetween(d('2024-02-28'), d('2024-03-01'))).toBe(2);
    expect(daysBetween(d('2026-03-01'), d('2026-02-28'))).toBe(-1);
  });
});

describe('lunarToSolar (Vietnam, UTC+7)', () => {
  it('finds Tết Nguyên Đán', () => {
    expect(solar(2024, 1, 1)).toBe('2024-02-10');
    expect(solar(2025, 1, 1)).toBe('2025-01-29');
    expect(solar(2026, 1, 1)).toBe('2026-02-17');
    expect(solar(2027, 1, 1)).toBe('2027-02-06');
    expect(solar(2028, 1, 1)).toBe('2028-01-26');
  });

  it('uses UTC+7, not the Chinese UTC+8 calendar', () => {
    // Tết 1985 was 21 Jan in Vietnam, 20 Feb in China.
    expect(solar(1985, 1, 1)).toBe('1985-01-21');
  });

  it('places months after a leap month correctly', () => {
    // 2025 has a leap 6th month: Mid-Autumn is 6 Oct, not early September.
    expect(solar(2025, 8, 15)).toBe('2025-10-06');
    expect(solar(2025, 6, 1, true)).toBe('2025-07-25');
    expect(solar(2026, 8, 15)).toBe('2026-09-25');
    expect(solar(2025, 7, 15)).toBe('2025-09-06');
    expect(solar(2026, 3, 10)).toBe('2026-04-26');
  });

  it('rejects a leap month the year does not have', () => {
    expect(solar(2026, 6, 1, true)).toBeNull();
    expect(solar(2025, 5, 1, true)).toBeNull();
  });

  it('handles lunar months 11 and 12, which fall in the next Gregorian year', () => {
    // 23 tháng Chạp Ất Tỵ (Ông Công Ông Táo) → 10 Feb 2026, a week before Tết 2026.
    expect(solar(2025, 12, 23)).toBe('2026-02-10');
  });
});

describe('seasonal calendar', () => {
  it('defines every id exactly once', () => {
    expect(SEASONAL_EVENTS.map((e) => e.id).sort()).toEqual([...SEASONAL_EVENT_IDS].sort());
  });

  it('validates ids', () => {
    expect(SeasonalEventIdSchema.safeParse('mid-autumn').success).toBe(true);
    expect(SeasonalEventIdSchema.safeParse('mid_autumn').success).toBe(false);
  });

  it('resolves n-th weekday rules', () => {
    expect(toIsoDate(occurrence('mothers-day', 2026).date)).toBe('2026-05-10');
    expect(toIsoDate(occurrence('fathers-day', 2026).date)).toBe('2026-06-21');
    expect(toIsoDate(occurrence('black-friday', 2025).date)).toBe('2025-11-28');
    expect(toIsoDate(occurrence('black-friday', 2026).date)).toBe('2026-11-27');
    expect(toIsoDate(occurrence('black-friday', 2027).date)).toBe('2027-11-26');
  });

  it('builds the window from lead/trail days', () => {
    const tet = occurrence('lunar-new-year', 2026);
    expect(toIsoDate(tet.start)).toBe('2026-01-27');
    expect(toIsoDate(tet.end)).toBe('2026-02-23');
  });

  it('sorts a year by main day', () => {
    const ids = getSeasonalCalendar(2026).map((o) => o.id);
    expect(ids[0]).toBe('new-year');
    expect(ids.at(-1)).toBe('christmas');
    expect(ids.indexOf('national-day')).toBeLessThan(ids.indexOf('mid-autumn'));
  });
});

describe('active event', () => {
  const active = (iso: string) => getActiveSeasonalEvent(d(iso))?.id ?? null;

  it('returns null between seasons', () => {
    expect(active('2026-07-15')).toBeNull();
  });

  it('themes for the event in its window', () => {
    expect(active('2026-09-20')).toBe('mid-autumn');
    expect(active('2026-11-23')).toBe('black-friday');
    expect(active('2026-11-30')).toBe('black-friday'); // Cyber Monday
    expect(active('2026-12-01')).toBeNull();
    expect(active('2026-12-20')).toBe('christmas');
  });

  it('lets the higher priority win an overlap', () => {
    // Valentine's (14 Feb) sits inside the 2026 Tết run-up.
    expect(getActiveSeasonalEvents(d('2026-02-12')).map((e) => e.id)).toEqual([
      'lunar-new-year',
      'valentines-day',
    ]);
    // National Day owns 2/9…
    expect(active('2026-09-02')).toBe('national-day');
    // …Teachers' Day beats the Black Friday run-up on 20/11, and 12.12 beats Christmas.
    expect(active('2026-11-20')).toBe('teachers-day');
    expect(active('2026-12-12')).toBe('double-twelve');
  });

  it('crosses the year boundary', () => {
    const nye = getActiveSeasonalEvent(d('2026-12-30'));
    expect(nye?.id).toBe('new-year');
    expect(toIsoDate(nye?.date ?? d('1970-01-01'))).toBe('2027-01-01');
    expect(nye?.daysUntil).toBe(2);
    expect(active('2027-01-02')).toBe('new-year');
  });

  it('reports days until the main day', () => {
    expect(getActiveSeasonalEvent(d('2026-11-23'))?.daysUntil).toBe(4);
    expect(getActiveSeasonalEvent(d('2026-11-27'))?.daysUntil).toBe(0);
    expect(getActiveSeasonalEvent(d('2026-11-29'))?.daysUntil).toBe(-2);
  });
});

describe('upcoming events', () => {
  it('lists the next windows in order, across the year end', () => {
    const next = getUpcomingSeasonalEvents(d('2026-11-23'), 4).map((e) => e.id);
    expect(next).toEqual(['double-twelve', 'christmas', 'new-year', 'lunar-new-year']);
  });
});

describe('vietnamToday', () => {
  it('uses UTC+7 whatever the device timezone', () => {
    expect(toIsoDate(vietnamToday(new Date('2026-09-01T16:59:59Z')))).toBe('2026-09-01');
    expect(toIsoDate(vietnamToday(new Date('2026-09-01T17:00:00Z')))).toBe('2026-09-02');
  });
});
