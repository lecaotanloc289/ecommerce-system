import type { ReactElement } from 'react';
import type { Motif } from '../../lib/seasonal-themes';
import { cn } from '../../lib/utils';

/**
 * Seasonal illustration motifs: original vector art on a 64×64 grid, coloured only with kit
 * token utilities (`fill-danger-9`, `stroke-warning-10`…) — no raw hex (DESIGN.md §1).
 * Colours are the motif's own (a lantern stays red/gold), not the active accent.
 */

/** Points of an n-pointed star centred on (cx, cy). */
function starPoints(cx: number, cy: number, outer: number, inner: number, n = 5): string {
  return Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

const ROTATE_5 = [0, 72, 144, 216, 288];
const ROTATE_6 = [0, 60, 120];
const ROTATE_12 = Array.from({ length: 12 }, (_, i) => i * 30);

const DRAW: Readonly<Record<Motif, () => ReactElement>> = {
  lantern: () => (
    <g>
      <path d="M32 1v9" className="stroke-warning-11" strokeWidth={2} />
      <rect x={22} y={9} width={20} height={5} rx={1.5} className="fill-warning-9" />
      <ellipse cx={32} cy={33} rx={20} ry={19} className="fill-danger-9" />
      <path
        d="M32 14c-9 6-9 32 0 38M32 14c9 6 9 32 0 38M20 22c-4 7-4 15 0 22M44 22c4 7 4 15 0 22"
        className="fill-none stroke-danger-11"
        strokeWidth={1.5}
      />
      <ellipse cx={26} cy={27} rx={4} ry={7} className="fill-danger-6" opacity={0.6} />
      <rect x={22} y={50} width={20} height={5} rx={1.5} className="fill-warning-9" />
      <path d="M27 55l-1 8M32 55v8M37 55l1 8" className="stroke-warning-10" strokeWidth={2} />
    </g>
  ),
  blossom: () => (
    <g>
      {ROTATE_5.map((deg) => (
        <ellipse
          key={deg}
          cx={32}
          cy={17}
          rx={9}
          ry={13}
          transform={`rotate(${deg} 32 32)`}
          className="fill-warning-9"
        />
      ))}
      {ROTATE_5.map((deg) => (
        <path
          key={`s${deg}`}
          d="M32 32V20"
          transform={`rotate(${deg + 36} 32 32)`}
          className="stroke-orange-11"
          strokeWidth={1.5}
        />
      ))}
      <circle cx={32} cy={32} r={6} className="fill-orange-10" />
    </g>
  ),
  star: () => <polygon points={starPoints(32, 33, 29, 12)} className="fill-warning-9" />,
  heart: () => (
    <g>
      <path
        d="M32 57C11 42 4 30 9 19 14 8 27 8 32 18c5-10 18-10 23 1 5 11-2 23-23 38z"
        className="fill-danger-9"
      />
      <ellipse cx={20} cy={22} rx={5} ry={3.5} className="fill-danger-6" opacity={0.7} />
    </g>
  ),
  snowflake: () => (
    <g className="fill-none stroke-info-7" strokeWidth={3} strokeLinecap="round">
      {ROTATE_6.map((deg) => (
        <g key={deg} transform={`rotate(${deg} 32 32)`}>
          <path d="M32 4v56" />
          <path d="M32 14l-7-6M32 14l7-6M32 50l-7 6M32 50l7 6" />
        </g>
      ))}
    </g>
  ),
  firework: () => (
    <g strokeLinecap="round">
      {ROTATE_12.map((deg, i) => (
        <g key={deg} transform={`rotate(${deg} 32 32)`}>
          <path
            d="M32 20V6"
            className={i % 2 ? 'stroke-danger-9' : 'stroke-warning-9'}
            strokeWidth={3}
          />
          <circle cx={32} cy={3} r={2} className={i % 2 ? 'fill-danger-9' : 'fill-warning-9'} />
        </g>
      ))}
      <circle cx={32} cy={32} r={5} className="fill-warning-9" />
    </g>
  ),
  moon: () => (
    <g>
      <circle cx={32} cy={32} r={28} className="fill-warning-5" />
      <circle cx={22} cy={24} r={6} className="fill-warning-6" />
      <circle cx={40} cy={40} r={8} className="fill-warning-6" />
      <circle cx={42} cy={20} r={3} className="fill-warning-6" />
    </g>
  ),
  gift: () => (
    <g>
      <rect x={8} y={26} width={48} height={34} rx={3} className="fill-danger-9" />
      <rect x={5} y={18} width={54} height={11} rx={2.5} className="fill-danger-10" />
      <rect x={28} y={18} width={8} height={42} className="fill-warning-9" />
      <path
        d="M32 18c-4-10-16-12-16-5s10 6 16 5zM32 18c4-10 16-12 16-5s-10 6-16 5z"
        className="fill-none stroke-warning-9"
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
    </g>
  ),
  flower: () => (
    <g>
      <path d="M32 34v28" className="stroke-success-10" strokeWidth={3} />
      <path d="M32 52c-10-2-14-10-14-14 8 0 13 6 14 14z" className="fill-success-9" />
      <path
        d="M18 12c4 4 8 6 14 6s10-2 14-6c2 12-1 24-14 24S16 24 18 12z"
        className="fill-danger-8"
      />
      <path d="M24 16c2-8 6-12 8-14 2 2 6 6 8 14-3 2-5 3-8 3s-5-1-8-3z" className="fill-danger-9" />
    </g>
  ),
  balloon: () => (
    <g>
      <path d="M32 46c-3 6 3 10 0 17" className="fill-none stroke-slate-8" strokeWidth={1.5} />
      <ellipse cx={32} cy={24} rx={18} ry={22} className="fill-info-9" />
      <path d="M29 48h6l-3-4z" className="fill-info-10" />
      <ellipse cx={25} cy={15} rx={4} ry={7} className="fill-info-5" opacity={0.7} />
    </g>
  ),
  pumpkin: () => (
    <g>
      <path d="M32 14c0-6 3-10 8-11" className="fill-none stroke-success-11" strokeWidth={4} />
      <ellipse cx={20} cy={38} rx={14} ry={19} className="fill-orange-10" />
      <ellipse cx={44} cy={38} rx={14} ry={19} className="fill-orange-10" />
      <ellipse cx={32} cy={38} rx={13} ry={21} className="fill-orange-9" />
      <path d="M24 34l4-5 4 5zM36 34l4-5 4 5z" className="fill-orange-12" />
      <path d="M23 44q9 7 18 0l-4 3-5-2-5 2z" className="fill-orange-12" />
    </g>
  ),
  tag: () => (
    <g>
      <path
        d="M6 30L30 6h26v26L32 56a4 4 0 0 1-6 0L6 36a4 4 0 0 1 0-6z"
        className="fill-danger-9"
      />
      <circle cx={46} cy={16} r={4} className="fill-base-0" />
      <circle cx={24} cy={28} r={3.5} className="fill-none stroke-base-0" strokeWidth={2.5} />
      <circle cx={36} cy={40} r={3.5} className="fill-none stroke-base-0" strokeWidth={2.5} />
      <path d="M38 26L22 42" className="stroke-base-0" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  ),
  book: () => (
    <g>
      <path
        d="M32 16C24 10 12 10 4 13v40c8-3 20-3 28 3z"
        className="fill-base-0 stroke-info-11"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d="M32 16c8-6 20-6 28-3v40c-8-3-20-3-28 3z"
        className="fill-info-3 stroke-info-11"
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
      <path
        d="M10 22c6-2 12-2 17 1M10 30c6-2 12-2 17 1M10 38c6-2 12-2 17 1"
        className="fill-none stroke-info-7"
        strokeWidth={2}
      />
      <path
        d="M44 4l8 8-14 14-9 2 2-9z"
        className="fill-warning-9 stroke-warning-11"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </g>
  ),
  sun: () => (
    <g>
      <polygon points={starPoints(32, 32, 30, 18, 14)} className="fill-orange-11" />
      <circle cx={32} cy={32} r={16} className="fill-warning-9" />
      <polygon points={starPoints(32, 32, 13, 5, 8)} className="fill-orange-11" />
    </g>
  ),
  leaf: () => (
    <g>
      <path d="M8 56C8 26 26 8 58 6 56 38 38 56 8 56z" className="fill-success-9" />
      <path
        d="M8 56L46 18M22 42h14M30 34V22M38 26h8"
        className="fill-none stroke-success-11"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </g>
  ),
  flag: () => (
    <g>
      <path d="M8 4v58" className="stroke-slate-9" strokeWidth={3} strokeLinecap="round" />
      <path d="M10 8c14-5 22 5 46 0v34c-24 5-32-5-46 0z" className="fill-danger-9" />
      <polygon points={starPoints(33, 26, 11, 4.4)} className="fill-warning-9" />
    </g>
  ),
};

/** A motif drawn as `<g>` in a 64×64 box — for composing inside a larger `<svg>`. */
export function MotifShape({ motif }: { motif: Motif }) {
  return DRAW[motif]();
}

/** A standalone decorative motif icon. */
export function MotifIcon({ motif, className }: { motif: Motif; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      className={cn('size-6 shrink-0', className)}
    >
      <MotifShape motif={motif} />
    </svg>
  );
}
