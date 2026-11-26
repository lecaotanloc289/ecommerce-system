'use client';

import * as React from 'react';
import { Heart } from 'lucide-react';
import { useT } from '../../i18n/use-locale';
import type { ReactionBurst } from '../../lib/live-events';
import { cn } from '../../lib/utils';

const MAX_HEARTS = 24;
const HEART_LIFETIME_MS = 2300;

interface FloatingHeart {
  id: number;
  drift: string;
}

/** Heart button; the floats are rendered by `FloatingHearts` inside the video frame. */
export function ReactionButton({
  onReact,
  className,
}: {
  onReact: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onReact}
      aria-label={t('live.react')}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border-default transition-transform hover:bg-bg-muted active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        className,
      )}
    >
      <Heart className="size-5 fill-danger-solid text-danger-solid" aria-hidden />
    </button>
  );
}

/** CSS float-up hearts (`.live-heart`). Not spawned at all under `prefers-reduced-motion`. */
export function FloatingHearts({ burst, className }: { burst: ReactionBurst; className?: string }) {
  const [hearts, setHearts] = React.useState<FloatingHeart[]>([]);
  const nextId = React.useRef(0);
  const timeouts = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  React.useEffect(() => {
    const pending = timeouts.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  React.useEffect(() => {
    if (burst.seq === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const added: FloatingHeart[] = Array.from({ length: Math.min(burst.count, 5) }, () => ({
      id: nextId.current++,
      drift: `${Math.round((Math.random() - 0.5) * 60)}px`,
    }));
    setHearts((prev) => [...prev, ...added].slice(-MAX_HEARTS));
    const ids = new Set(added.map((h) => h.id));
    const timer = setTimeout(() => {
      timeouts.current.delete(timer);
      setHearts((prev) => prev.filter((h) => !ids.has(h.id)));
    }, HEART_LIFETIME_MS);
    timeouts.current.add(timer);
  }, [burst]);

  return (
    <div aria-hidden className={cn('pointer-events-none absolute bottom-3 right-3', className)}>
      {hearts.map((h) => (
        <Heart
          key={h.id}
          className="live-heart absolute bottom-0 right-0 size-6 fill-danger-solid text-danger-solid"
          style={{ '--live-drift': h.drift } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
