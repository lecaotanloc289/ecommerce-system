'use client';

import { RISING_MOTIFS, SEASONAL_VISUALS } from '../../lib/seasonal-themes';
import { useAppearance } from '../../store/appearance-store';
import { MotifIcon } from './motifs';

const COUNT = 12;

/** Deterministic spread so every visit looks the same and nothing depends on Math.random. */
const PARTICLES = Array.from({ length: COUNT }, (_, i) => ({
  left: (i * 37 + 7) % 100,
  sizeRem: 1 + ((i * 7) % 5) * 0.35,
  durationS: 11 + ((i * 5) % 9),
  // Negative delays start each particle mid-flight, so the screen isn't empty at first.
  delayS: -((i * 2.3) % 18),
  opacity: 0.45 + ((i * 3) % 4) * 0.1,
}));

/**
 * Falling petals / snow / rising lanterns for the displayed event. Purely decorative:
 * `aria-hidden`, no pointer events, hidden under prefers-reduced-motion and when the
 * user turns effects off.
 */
export function SeasonalEffects() {
  const { event, prefs } = useAppearance();
  if (!event || !prefs.effects) return null;

  const motif = SEASONAL_VISUALS[event.id].motifs[0];
  const keyframes = RISING_MOTIFS.has(motif) ? 'seasonRise' : 'seasonFall';

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden motion-reduce:hidden"
    >
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={{
            left: `${p.left}%`,
            width: `${p.sizeRem}rem`,
            height: `${p.sizeRem}rem`,
            opacity: p.opacity,
            animation: `${keyframes} ${p.durationS}s linear ${p.delayS}s infinite`,
          }}
        >
          <MotifIcon motif={motif} className="size-full" />
        </span>
      ))}
    </div>
  );
}
