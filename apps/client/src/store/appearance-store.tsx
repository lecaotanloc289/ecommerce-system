'use client';

import * as React from 'react';
import {
  daysBetween,
  getActiveSeasonalEvent,
  getSeasonalOccurrence,
  SEASONAL_EVENTS,
  SeasonalEventIdSchema,
  toIsoDate,
  vietnamToday,
  type CalendarDate,
  type SeasonalEventId,
  type SeasonalEventOccurrence,
} from '@repo/core';
import { ACCENTS, SEASONAL_VISUALS, type Accent } from '../lib/seasonal-themes';
import { readStored, writeStored } from './persisted';

/**
 * Appearance preferences (colour mode, accent, corners, text size, seasonal themes) + the
 * seasonal event the storefront is currently dressed for.
 *
 * Storage (read before first paint by the no-flash script in `app/layout.tsx` — keep in sync):
 * - `appearance`         AppearancePrefs JSON (localStorage)
 * - `appearance-accent`  `{ accent, until }` — the accent a seasonal event resolved to and the
 *                        last day (VN, ISO) it applies, so event colours paint without a flash.
 */
export const APPEARANCE_STORAGE_KEY = 'appearance';
export const RESOLVED_ACCENT_STORAGE_KEY = 'appearance-accent';

export const COLOR_MODES = ['light', 'dark', 'system'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
export const RADII = ['sharp', 'default', 'round'] as const;
export type Radius = (typeof RADII)[number];
export const FONT_SCALES = ['sm', 'md', 'lg'] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export type AccentChoice = 'auto' | Accent;

export interface AppearancePrefs {
  mode: ColorMode;
  /** `auto` = the running event's accent, Elma indigo between events. */
  accent: AccentChoice;
  radius: Radius;
  fontScale: FontScale;
  /** Event banner, picks and event accent. */
  seasonal: boolean;
  /** Falling/rising decorations (never shown with prefers-reduced-motion). */
  effects: boolean;
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  mode: 'system',
  accent: 'auto',
  radius: 'default',
  fontScale: 'md',
  seasonal: true,
  effects: true,
};

/** The event the UI is showing: today's (when seasonal themes are on) or a preview. */
export interface DisplayedEvent extends SeasonalEventOccurrence {
  /** Days from today to the main day: >0 run-up, 0 today, <0 after. */
  daysUntil: number;
  isPreview: boolean;
}

interface AppearanceContextValue {
  prefs: AppearancePrefs;
  setPref: <K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]) => void;
  reset: () => void;
  isDark: boolean;
  /** Accent actually applied (after resolving `auto`). */
  accent: Accent;
  /** Today in Vietnam; null until mounted (prerendered HTML has no date). */
  today: CalendarDate | null;
  /** Today's event regardless of the `seasonal` switch, for hints. */
  activeEvent: DisplayedEvent | null;
  event: DisplayedEvent | null;
  preview: SeasonalEventId | null;
  setPreview: (id: SeasonalEventId | null) => void;
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null);

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((o) => o === value) ?? fallback;
}

function sanitize(stored: unknown): AppearancePrefs | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const get = (key: string): unknown => (key in stored ? Reflect.get(stored, key) : undefined);
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
  return {
    mode: pick(COLOR_MODES, get('mode'), DEFAULT_APPEARANCE.mode),
    accent: pick<AccentChoice>(['auto', ...ACCENTS], get('accent'), DEFAULT_APPEARANCE.accent),
    radius: pick(RADII, get('radius'), DEFAULT_APPEARANCE.radius),
    fontScale: pick(FONT_SCALES, get('fontScale'), DEFAULT_APPEARANCE.fontScale),
    seasonal: bool(get('seasonal'), DEFAULT_APPEARANCE.seasonal),
    effects: bool(get('effects'), DEFAULT_APPEARANCE.effects),
  };
}

/** Pre-appearance builds stored only `theme` = 'light' | 'dark' (raw string, not JSON). */
function legacyMode(): ColorMode | undefined {
  try {
    const theme = window.localStorage.getItem('theme');
    return theme === 'light' || theme === 'dark' ? theme : undefined;
  } catch {
    return undefined;
  }
}

function useSystemDark(): boolean {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** The preview's current-or-next occurrence, so a past event previews next year's dates. */
function previewOccurrence(id: SeasonalEventId, today: CalendarDate): DisplayedEvent | null {
  const def = SEASONAL_EVENTS.find((e) => e.id === id);
  if (!def) return null;
  let occurrence = getSeasonalOccurrence(def, today.year);
  if (daysBetween(today, occurrence.end) < 0) {
    occurrence = getSeasonalOccurrence(def, today.year + 1);
  }
  return { ...occurrence, daysUntil: daysBetween(today, occurrence.date), isPreview: true };
}

function setAttr(root: HTMLElement, name: string, value: string | null) {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = React.useState<AppearancePrefs>(DEFAULT_APPEARANCE);
  const [hydrated, setHydrated] = React.useState(false);
  const [today, setToday] = React.useState<CalendarDate | null>(null);
  const [preview, setPreviewState] = React.useState<SeasonalEventId | null>(null);
  const systemDark = useSystemDark();

  React.useEffect(() => {
    const saved = sanitize(readStored('local', APPEARANCE_STORAGE_KEY));
    const legacy = legacyMode();
    if (saved) setPrefs(saved);
    else if (legacy) setPrefs({ ...DEFAULT_APPEARANCE, mode: legacy });
    setToday(vietnamToday(new Date()));
    setHydrated(true);

    // A tab left open across midnight (VN time) picks up the new day when it is shown again.
    const refreshToday = () => {
      if (document.visibilityState !== 'visible') return;
      const next = vietnamToday(new Date());
      setToday((prev) => (prev && toIsoDate(prev) === toIsoDate(next) ? prev : next));
    };
    document.addEventListener('visibilitychange', refreshToday);
    return () => document.removeEventListener('visibilitychange', refreshToday);
  }, []);

  const activeEvent = React.useMemo<DisplayedEvent | null>(() => {
    const found = today ? getActiveSeasonalEvent(today) : null;
    return found ? { ...found, isPreview: false } : null;
  }, [today]);

  const event = React.useMemo<DisplayedEvent | null>(() => {
    if (preview && today) return previewOccurrence(preview, today);
    return prefs.seasonal ? activeEvent : null;
  }, [preview, today, prefs.seasonal, activeEvent]);

  const accent: Accent =
    prefs.accent !== 'auto' ? prefs.accent : event ? SEASONAL_VISUALS[event.id].accent : 'indigo';
  const isDark = prefs.mode === 'system' ? systemDark : prefs.mode === 'dark';

  React.useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    setAttr(root, 'data-accent', accent === 'indigo' ? null : accent);
    setAttr(root, 'data-radius', prefs.radius === 'default' ? null : prefs.radius);
    setAttr(root, 'data-font-scale', prefs.fontScale === 'md' ? null : prefs.fontScale);
  }, [hydrated, isDark, accent, prefs.radius, prefs.fontScale]);

  React.useEffect(() => {
    if (!hydrated) return;
    writeStored('local', APPEARANCE_STORAGE_KEY, prefs);
    // Cache what the NEXT load should paint: today's real event, never a (temporary) preview.
    const resolved =
      prefs.accent === 'auto' && prefs.seasonal && activeEvent
        ? { accent: SEASONAL_VISUALS[activeEvent.id].accent, until: toIsoDate(activeEvent.end) }
        : null;
    writeStored('local', RESOLVED_ACCENT_STORAGE_KEY, resolved);
  }, [hydrated, prefs, activeEvent]);

  const setPref = React.useCallback(
    <K extends keyof AppearancePrefs>(key: K, value: AppearancePrefs[K]) =>
      setPrefs((p) => ({ ...p, [key]: value })),
    [],
  );
  const reset = React.useCallback(() => {
    setPrefs(DEFAULT_APPEARANCE);
    setPreviewState(null);
  }, []);
  const setPreview = React.useCallback((id: SeasonalEventId | null) => {
    setPreviewState(id === null ? null : SeasonalEventIdSchema.parse(id));
  }, []);

  const value = React.useMemo<AppearanceContextValue>(
    () => ({
      prefs,
      setPref,
      reset,
      isDark,
      accent,
      today,
      activeEvent,
      event,
      preview,
      setPreview,
    }),
    [prefs, setPref, reset, isDark, accent, today, activeEvent, event, preview, setPreview],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = React.useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within <AppearanceProvider>');
  return ctx;
}
