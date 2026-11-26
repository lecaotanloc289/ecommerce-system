/**
 * Vietnamese lunisolar calendar → Gregorian conversion.
 *
 * Astronomical algorithm by Hồ Ngọc Đức ("Âm lịch Việt Nam", based on Jean Meeus,
 * "Astronomical Algorithms"). Vietnam reckons lunar months at UTC+7, which is why some
 * dates differ from the Chinese (UTC+8) calendar — e.g. Tết 1985, 2007.
 * Accurate for roughly 1800–2199, far wider than a storefront needs.
 */

/** A day on the Gregorian calendar, in Vietnam local time. `month` is 1-12. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface LunarDate {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  /** 1-30. */
  readonly day: number;
  /** True for the intercalary (nhuận) copy of `month`. */
  readonly leap?: boolean;
}

/** Vietnam standard time, UTC+7 (no daylight saving). */
export const VIETNAM_UTC_OFFSET_HOURS = 7;

const SYNODIC_MONTH = 29.530588853;
const NEW_MOON_EPOCH = 2415021.076998695; // Julian day of the new moon of 1900-01-01
const DEG = Math.PI / 180;

/** Julian day number of a Gregorian date. */
export function toJulianDay({ year, month, day }: CalendarDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** Gregorian date of a Julian day number. */
export function fromJulianDay(jd: number): CalendarDate {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/** Julian day (fractional, UT) of the k-th new moon after 1900-01-01. */
function newMoon(k: number): number {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
  jd += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * DEG);
  const sunAnomaly = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const moonAnomaly = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const latitude = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 =
    (0.1734 - 0.000393 * t) * Math.sin(sunAnomaly * DEG) + 0.0021 * Math.sin(2 * DEG * sunAnomaly);
  c1 -= 0.4068 * Math.sin(moonAnomaly * DEG) - 0.0161 * Math.sin(2 * DEG * moonAnomaly);
  c1 -= 0.0004 * Math.sin(3 * DEG * moonAnomaly);
  c1 += 0.0104 * Math.sin(2 * DEG * latitude) - 0.0051 * Math.sin(DEG * (sunAnomaly + moonAnomaly));
  c1 -= 0.0074 * Math.sin(DEG * (sunAnomaly - moonAnomaly));
  c1 += 0.0004 * Math.sin(DEG * (2 * latitude + sunAnomaly));
  c1 -= 0.0004 * Math.sin(DEG * (2 * latitude - sunAnomaly));
  c1 -= 0.0006 * Math.sin(DEG * (2 * latitude + moonAnomaly));
  c1 += 0.001 * Math.sin(DEG * (2 * latitude - moonAnomaly));
  c1 += 0.0005 * Math.sin(DEG * (2 * moonAnomaly + sunAnomaly));
  const deltaT =
    t < -11
      ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3
      : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return jd + c1 - deltaT;
}

/** Sun's ecliptic longitude (radians, 0..2π) at a fractional Julian day. */
function sunLongitude(jd: number): number {
  const t = (jd - 2451545.0) / 36525;
  const t2 = t * t;
  const meanAnomaly = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const meanLongitude = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  const center =
    (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(DEG * meanAnomaly) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * DEG * meanAnomaly) +
    0.00029 * Math.sin(3 * DEG * meanAnomaly);
  const longitude = (meanLongitude + center) * DEG;
  return longitude - 2 * Math.PI * Math.floor(longitude / (2 * Math.PI));
}

/** Local day number on which the k-th new moon falls. */
function newMoonDay(k: number, tz: number): number {
  return Math.floor(newMoon(k) + 0.5 + tz / 24);
}

/** Solar-term sector (0-11, 30° each) at the start of a local day. */
function sunSector(dayNumber: number, tz: number): number {
  return Math.floor((sunLongitude(dayNumber - 0.5 - tz / 24) / Math.PI) * 6);
}

/** Day number on which lunar month 11 (the one containing the winter solstice) of `year` starts. */
function lunarMonth11Start(year: number, tz: number): number {
  const offset = toJulianDay({ year, month: 12, day: 31 }) - 2415021;
  const k = Math.floor(offset / SYNODIC_MONTH);
  const start = newMoonDay(k, tz);
  return sunSector(start, tz) >= 9 ? newMoonDay(k - 1, tz) : start;
}

/** Index (after month 11) of the first month with no principal solar term → the leap month. */
function leapMonthOffset(month11Start: number, tz: number): number {
  const k = Math.floor((month11Start - NEW_MOON_EPOCH) / SYNODIC_MONTH + 0.5);
  let i = 1;
  let arc = sunSector(newMoonDay(k + i, tz), tz);
  let last: number;
  do {
    last = arc;
    i += 1;
    arc = sunSector(newMoonDay(k + i, tz), tz);
  } while (arc !== last && i < 14);
  return i - 1;
}

/**
 * Gregorian date of a Vietnamese lunar date. Returns `null` when `leap` is set but that
 * lunar year has no leap copy of `month`.
 */
export function lunarToSolar(
  lunar: LunarDate,
  tz: number = VIETNAM_UTC_OFFSET_HOURS,
): CalendarDate | null {
  const { year, month, day, leap = false } = lunar;
  const [a11, b11] =
    month < 11
      ? [lunarMonth11Start(year - 1, tz), lunarMonth11Start(year, tz)]
      : [lunarMonth11Start(year, tz), lunarMonth11Start(year + 1, tz)];
  const k = Math.floor(0.5 + (a11 - NEW_MOON_EPOCH) / SYNODIC_MONTH);
  let offset = month - 11;
  if (offset < 0) offset += 12;

  if (b11 - a11 > 365) {
    // 13-month year: one month is intercalary.
    const leapOffset = leapMonthOffset(a11, tz);
    let leapMonth = leapOffset - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && month !== leapMonth) return null;
    if (leap || offset >= leapOffset) offset += 1;
  } else if (leap) {
    return null;
  }

  return fromJulianDay(newMoonDay(k + offset, tz) + day - 1);
}
