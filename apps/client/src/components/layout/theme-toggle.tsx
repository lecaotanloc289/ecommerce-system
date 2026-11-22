'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useT } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

/** Toggles `.dark` on <html> and persists to localStorage (DESIGN.md §2/§9). */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    window.localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <button
      type="button"
      onClick={toggle}
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
