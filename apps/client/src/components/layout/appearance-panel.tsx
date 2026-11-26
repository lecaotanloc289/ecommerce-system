'use client';

import * as React from 'react';
import { Monitor, Moon, Palette, RotateCcw, Sparkles, Sun } from 'lucide-react';
import { SEASONAL_EVENT_IDS, SeasonalEventIdSchema } from '@repo/core';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Switch,
} from '@repo/ui';
import { useT, type MessageKey } from '../../i18n/use-locale';
import { ACCENT_LABELS, ACCENT_SWATCH, ACCENTS } from '../../lib/seasonal-themes';
import { cn } from '../../lib/utils';
import {
  COLOR_MODES,
  FONT_SCALES,
  RADII,
  useAppearance,
  type AccentChoice,
  type ColorMode,
  type FontScale,
  type Radius,
} from '../../store/appearance-store';

const MODE_OPTIONS: Readonly<Record<ColorMode, { label: MessageKey; icon: typeof Sun }>> = {
  light: { label: 'appearance.modeLight', icon: Sun },
  dark: { label: 'appearance.modeDark', icon: Moon },
  system: { label: 'appearance.modeSystem', icon: Monitor },
};
const RADIUS_LABELS: Readonly<Record<Radius, MessageKey>> = {
  sharp: 'appearance.radiusSharp',
  default: 'appearance.radiusDefault',
  round: 'appearance.radiusRound',
};
/** Corner sample per preset — fixed values so the sample doesn't follow the active preset. */
const RADIUS_SAMPLE: Readonly<Record<Radius, string>> = {
  sharp: 'rounded-[0.125rem]',
  default: 'rounded-[0.5rem]',
  round: 'rounded-[1rem]',
};
const FONT_LABELS: Readonly<Record<FontScale, MessageKey>> = {
  sm: 'appearance.fontScaleSm',
  md: 'appearance.fontScaleMd',
  lg: 'appearance.fontScaleLg',
};
const FONT_SAMPLE: Readonly<Record<FontScale, string>> = {
  sm: 'text-body-s',
  md: 'text-body-l',
  lg: 'text-h5',
};

const optionClass = cn(
  'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-border-default bg-bg-elevated px-2 py-2.5 text-body-s font-medium text-text-body transition-colors',
  'hover:bg-bg-muted',
  'has-checked:border-brand-solid has-checked:bg-brand-soft has-checked:text-brand-text',
  'has-focus-visible:ring-2 has-focus-visible:ring-border-focus has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-bg-page',
);

/** Native radio group styled as tiles — keyboard (arrows) and screen readers for free. */
function OptionGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  render,
  columns = 3,
}: {
  name: string;
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (option: T) => React.ReactNode;
  columns?: 3 | 4;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-body-m font-semibold text-text-primary">{legend}</legend>
      <div className={cn('grid gap-2', columns === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {options.map((option) => (
          <label key={option} className={optionClass}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {render(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-body-m font-semibold text-text-primary">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-body-s text-text-muted">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}

/** Drawer with every appearance option + event preview. Trigger lives in the navbar. */
export function AppearancePanel({ className }: { className?: string }) {
  const t = useT();
  const { prefs, setPref, reset, activeEvent, preview, setPreview } = useAppearance();
  const accentOptions: readonly AccentChoice[] = ['auto', ...ACCENTS];

  return (
    <Drawer>
      <DrawerTrigger
        aria-label={t('appearance.open')}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-md text-text-body transition-colors hover:bg-bg-muted hover:text-brand-text',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          className,
        )}
      >
        <Palette className="size-5" />
      </DrawerTrigger>
      <DrawerContent side="right" className="w-full max-w-sm overflow-y-auto p-5">
        <DrawerHeader className="mb-4">
          <DrawerTitle className="font-heading text-h5">{t('appearance.title')}</DrawerTitle>
          <DrawerDescription className="text-body-s text-text-muted">
            {t('appearance.description')}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-6">
          <OptionGroup
            name="appearance-mode"
            legend={t('appearance.mode')}
            options={COLOR_MODES}
            value={prefs.mode}
            onChange={(v) => setPref('mode', v)}
            render={(mode) => {
              const { icon: Icon, label } = MODE_OPTIONS[mode];
              return (
                <>
                  <Icon className="size-5" aria-hidden />
                  {t(label)}
                </>
              );
            }}
          />

          <div className="flex flex-col gap-2">
            <OptionGroup
              name="appearance-accent"
              legend={t('appearance.accent')}
              options={accentOptions}
              value={prefs.accent}
              onChange={(v) => setPref('accent', v)}
              columns={4}
              render={(accent) => (
                <>
                  {accent === 'auto' ? (
                    <span className="flex size-7 items-center justify-center rounded-full bg-brand-solid text-text-on-primary">
                      <Sparkles className="size-4" aria-hidden />
                    </span>
                  ) : (
                    <span className={cn('size-7 rounded-full', ACCENT_SWATCH[accent])} />
                  )}
                  <span className="text-center leading-tight">
                    {t(accent === 'auto' ? 'appearance.accentAuto' : ACCENT_LABELS[accent])}
                  </span>
                </>
              )}
            />
            {prefs.accent === 'auto' ? (
              <p className="text-body-s text-text-muted">
                {activeEvent && prefs.seasonal
                  ? t('appearance.accentAutoActive', {
                      event: t(`events.${activeEvent.id}.name`),
                    })
                  : t('appearance.accentAutoIdle')}
              </p>
            ) : null}
          </div>

          <OptionGroup
            name="appearance-radius"
            legend={t('appearance.radius')}
            options={RADII}
            value={prefs.radius}
            onChange={(v) => setPref('radius', v)}
            render={(radius) => (
              <>
                <span
                  className={cn(
                    'size-6 border-2 border-current border-b-0 border-l-0',
                    RADIUS_SAMPLE[radius],
                  )}
                  aria-hidden
                />
                {t(RADIUS_LABELS[radius])}
              </>
            )}
          />

          <OptionGroup
            name="appearance-font-scale"
            legend={t('appearance.fontScale')}
            options={FONT_SCALES}
            value={prefs.fontScale}
            onChange={(v) => setPref('fontScale', v)}
            render={(scale) => (
              <>
                <span
                  className={cn('font-heading font-bold leading-none', FONT_SAMPLE[scale])}
                  aria-hidden
                >
                  Aa
                </span>
                {t(FONT_LABELS[scale])}
              </>
            )}
          />

          <div className="flex flex-col gap-4 border-t border-border-faint pt-6">
            <SwitchRow
              id="appearance-seasonal"
              label={t('appearance.seasonal')}
              hint={t('appearance.seasonalHint')}
              checked={prefs.seasonal}
              onChange={(v) => setPref('seasonal', v)}
            />
            <SwitchRow
              id="appearance-effects"
              label={t('appearance.effects')}
              hint={t('appearance.effectsHint')}
              checked={prefs.effects}
              onChange={(v) => setPref('effects', v)}
            />
            <div className="flex flex-col gap-2">
              <label
                htmlFor="appearance-preview"
                className="text-body-m font-semibold text-text-primary"
              >
                {t('appearance.preview')}
              </label>
              <select
                id="appearance-preview"
                value={preview ?? ''}
                onChange={(e) => {
                  const parsed = SeasonalEventIdSchema.safeParse(e.target.value);
                  setPreview(parsed.success ? parsed.data : null);
                }}
                className="h-10 rounded-md border border-border-input bg-bg-elevated px-3 text-body-m text-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <option value="">{t('appearance.previewNone')}</option>
                {SEASONAL_EVENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`events.${id}.name`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button variant="outline" onClick={reset} className="w-full">
            <RotateCcw className="size-4" aria-hidden />
            {t('appearance.reset')}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
