import type { SeasonalEventId } from '@repo/core';
import { SEASONAL_VISUALS, type Accent, type Motif } from '../../lib/seasonal-themes';
import { cn } from '../../lib/utils';
import { MotifShape } from './motifs';

/** Halo + backdrop per event accent. Raw kit scales on purpose: the artwork keeps the event's
 *  own colours even when the user pinned a different accent. */
const HALO: Readonly<Record<Accent, { outer: string; inner: string }>> = {
  indigo: { outer: 'fill-indigo-3', inner: 'fill-indigo-4' },
  red: { outer: 'fill-danger-3', inner: 'fill-danger-4' },
  orange: { outer: 'fill-orange-3', inner: 'fill-orange-4' },
  green: { outer: 'fill-success-3', inner: 'fill-success-4' },
  teal: { outer: 'fill-teal-3', inner: 'fill-teal-4' },
  blue: { outer: 'fill-info-3', inner: 'fill-info-4' },
  purple: { outer: 'fill-purple-3', inner: 'fill-purple-4' },
};

/** Place a 64×64 motif centred at (x, y), `size` px wide, optionally tilted. */
function Placed({
  motif,
  x,
  y,
  size,
  rotate = 0,
  opacity = 1,
}: {
  motif: Motif;
  x: number;
  y: number;
  size: number;
  rotate?: number;
  opacity?: number;
}) {
  const s = size / 64;
  return (
    <g
      opacity={opacity}
      transform={`translate(${x - size / 2} ${y - size / 2}) rotate(${rotate} ${size / 2} ${size / 2}) scale(${s})`}
    >
      <MotifShape motif={motif} />
    </g>
  );
}

/** Sparkle dots scattered deterministically (same layout server and client). */
const SPARKLES: readonly (readonly [number, number, number])[] = [
  [48, 52, 4],
  [352, 40, 5],
  [370, 210, 3],
  [30, 230, 3],
  [120, 24, 3],
  [300, 270, 4],
  [78, 150, 2.5],
  [330, 130, 2.5],
];

/**
 * Decorative illustration for an event (decorative → `aria-hidden`; the event name is always
 * rendered as text next to it). `compact` drops the secondary motifs for small thumbnails.
 */
export function EventArt({
  eventId,
  compact = false,
  className,
}: {
  eventId: SeasonalEventId;
  compact?: boolean;
  className?: string;
}) {
  const { accent, motifs } = SEASONAL_VISUALS[eventId];
  const [main, second, third] = motifs;
  const halo = HALO[accent];

  return (
    <svg
      viewBox="0 0 400 300"
      aria-hidden
      focusable="false"
      className={cn('h-auto w-full', className)}
      preserveAspectRatio="xMidYMid meet"
    >
      <circle cx={200} cy={150} r={140} className={cn(halo.outer, 'dark:opacity-25')} />
      <circle cx={200} cy={150} r={96} className={cn(halo.inner, 'opacity-80 dark:opacity-30')} />
      {compact ? null : (
        <>
          <Placed motif={second} x={78} y={84} size={92} rotate={-12} />
          <Placed motif={third} x={330} y={222} size={84} rotate={10} />
          <Placed motif={third} x={326} y={72} size={44} rotate={18} opacity={0.75} />
          <Placed motif={second} x={88} y={236} size={40} rotate={-8} opacity={0.75} />
          {SPARKLES.map(([x, y, r]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className="fill-warning-9" />
          ))}
        </>
      )}
      <Placed motif={main} x={200} y={150} size={compact ? 200 : 168} />
    </svg>
  );
}
