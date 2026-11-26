'use client';

import { Moon, Sun } from 'lucide-react';
import { useT } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';
import { useAppearance } from '../../store/appearance-store';

/**
 * Quick light/dark switch (DESIGN.md §2/§9). Pins an explicit mode; "follow system" and the
 * other appearance options live in the AppearancePanel drawer.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { isDark, setPref } = useAppearance();

  return (
    <button
      type="button"
      onClick={() => setPref('mode', isDark ? 'light' : 'dark')}
      aria-label={t('common.toggleDarkMode')}
      aria-pressed={isDark}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-md text-text-body',
        'transition-colors hover:bg-bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
        className,
      )}
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
