'use client';

import { useAppearance } from '../../store/appearance-store';
import { SeasonalEffects } from '../seasonal/seasonal-effects';
import { SeasonalHero } from '../seasonal/seasonal-hero';
import { SeasonalPicks } from '../seasonal/seasonal-picks';
import { HeroCarousel } from './hero-carousel';

/**
 * Home hero: the running/previewed event takes over; otherwise the auto-advancing carousel
 * (Elements/Header/001). The server render has no appearance state, so it always starts as
 * the carousel and swaps after mount.
 */
export function HomeHero() {
  const { event } = useAppearance();
  return (
    <>
      <SeasonalEffects />
      {event ? <SeasonalHero event={event} /> : <HeroCarousel />}
    </>
  );
}

/** Event picks — trending categories for the season; nothing when no event is shown. */
export function HomeSeasonalPicks() {
  const { event } = useAppearance();
  return event ? <SeasonalPicks event={event} /> : null;
}
