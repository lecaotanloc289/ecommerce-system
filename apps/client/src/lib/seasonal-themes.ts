import type { SeasonalEventId } from '@repo/core';
import type { MessageKey } from '@repo/i18n';

/**
 * Brand palettes the user (or the season) can switch to. Each one is a `data-accent` preset in
 * `@repo/ui/styles/themes.css`; `indigo` is the Elma default and sets no attribute.
 */
export const ACCENTS = ['indigo', 'red', 'orange', 'green', 'teal', 'blue', 'purple'] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_LABELS: Readonly<Record<Accent, MessageKey>> = {
  indigo: 'appearance.accentIndigo',
  red: 'appearance.accentRed',
  orange: 'appearance.accentOrange',
  green: 'appearance.accentGreen',
  teal: 'appearance.accentTeal',
  blue: 'appearance.accentBlue',
  purple: 'appearance.accentPurple',
};

/**
 * Swatch fill per accent = the solid step themes.css maps to `brand-solid`. Indigo uses a pinned
 * copy because `--color-indigo-*` itself is what the active accent overrides.
 */
export const ACCENT_SWATCH: Readonly<Record<Accent, string>> = {
  indigo: 'bg-[var(--color-accent-swatch-indigo)]',
  red: 'bg-danger-9',
  orange: 'bg-orange-11',
  green: 'bg-success-11',
  teal: 'bg-teal-11',
  blue: 'bg-info-9',
  purple: 'bg-purple-10',
};

export const MOTIFS = [
  'lantern',
  'blossom',
  'star',
  'heart',
  'snowflake',
  'firework',
  'moon',
  'gift',
  'flower',
  'balloon',
  'pumpkin',
  'tag',
  'book',
  'sun',
  'leaf',
  'flag',
] as const;
export type Motif = (typeof MOTIFS)[number];

/** Motifs that float upwards in the decoration layer instead of falling. */
export const RISING_MOTIFS: ReadonlySet<Motif> = new Set<Motif>(['lantern', 'balloon']);

export interface SeasonalVisual {
  readonly accent: Accent;
  /** First motif is the hero of the artwork and the one used for decorations. */
  readonly motifs: readonly [Motif, Motif, Motif];
  /** Mock category slugs to feature as "picks" while the event runs. */
  readonly categories: readonly string[];
}

export const SEASONAL_VISUALS: Readonly<Record<SeasonalEventId, SeasonalVisual>> = {
  'new-year': {
    accent: 'purple',
    motifs: ['firework', 'star', 'gift'],
    categories: ['wearables', 'audio'],
  },
  'lunar-new-year': {
    accent: 'red',
    motifs: ['blossom', 'lantern', 'firework'],
    categories: ['accessories', 'audio', 'cameras'],
  },
  'lantern-festival': {
    accent: 'orange',
    motifs: ['lantern', 'moon', 'star'],
    categories: ['accessories', 'audio'],
  },
  'valentines-day': {
    accent: 'red',
    motifs: ['heart', 'gift', 'flower'],
    categories: ['wearables', 'fashion', 'accessories'],
  },
  'womens-day': {
    accent: 'purple',
    motifs: ['flower', 'heart', 'gift'],
    categories: ['fashion', 'wearables', 'accessories'],
  },
  'hung-kings': {
    accent: 'orange',
    motifs: ['sun', 'leaf', 'star'],
    categories: ['cameras', 'audio'],
  },
  'reunification-day': {
    accent: 'red',
    motifs: ['flag', 'star', 'firework'],
    categories: ['cameras', 'audio', 'computers'],
  },
  'mothers-day': {
    accent: 'purple',
    motifs: ['flower', 'heart', 'gift'],
    categories: ['wearables', 'fashion'],
  },
  'childrens-day': {
    accent: 'blue',
    motifs: ['balloon', 'star', 'gift'],
    categories: ['audio', 'computers'],
  },
  'dragon-boat': {
    accent: 'green',
    motifs: ['leaf', 'sun', 'star'],
    categories: ['accessories', 'wearables'],
  },
  'fathers-day': {
    accent: 'teal',
    motifs: ['gift', 'star', 'heart'],
    categories: ['wearables', 'cameras', 'audio'],
  },
  'family-day': {
    accent: 'green',
    motifs: ['heart', 'sun', 'leaf'],
    categories: ['audio', 'computers'],
  },
  'vu-lan': {
    accent: 'red',
    motifs: ['flower', 'heart', 'lantern'],
    categories: ['wearables', 'accessories'],
  },
  'national-day': {
    accent: 'red',
    motifs: ['flag', 'star', 'firework'],
    categories: ['cameras', 'audio', 'computers'],
  },
  'mid-autumn': {
    accent: 'orange',
    motifs: ['lantern', 'moon', 'star'],
    categories: ['accessories', 'audio'],
  },
  'vietnamese-womens-day': {
    accent: 'purple',
    motifs: ['flower', 'heart', 'gift'],
    categories: ['fashion', 'wearables', 'accessories'],
  },
  halloween: {
    accent: 'orange',
    motifs: ['pumpkin', 'moon', 'star'],
    categories: ['audio', 'accessories'],
  },
  'singles-day': {
    accent: 'orange',
    motifs: ['tag', 'firework', 'gift'],
    categories: ['computers', 'audio', 'wearables'],
  },
  'teachers-day': {
    accent: 'blue',
    motifs: ['book', 'flower', 'star'],
    categories: ['computers', 'accessories'],
  },
  'black-friday': {
    accent: 'red',
    motifs: ['tag', 'gift', 'star'],
    categories: ['computers', 'cameras', 'audio'],
  },
  'double-twelve': {
    accent: 'purple',
    motifs: ['tag', 'firework', 'star'],
    categories: ['computers', 'wearables'],
  },
  christmas: {
    accent: 'green',
    motifs: ['snowflake', 'gift', 'star'],
    categories: ['audio', 'wearables', 'accessories'],
  },
};
