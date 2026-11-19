'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Container } from '../layout/container';
import { ButtonLink } from '../common/button-link';
import { useT, type MessageKey } from '../../i18n/locale-provider';
import { cn } from '../../lib/utils';

type Slide = {
  titleKey: MessageKey;
  subtitleKey: MessageKey;
  image: string;
  href: string;
};

const SLIDES: Slide[] = [
  {
    titleKey: 'home.slide1Title',
    subtitleKey: 'home.slide1Subtitle',
    image: 'https://picsum.photos/seed/elma-hero-headphones/800/620',
    href: '/product/beats-by-dre-c-3450',
  },
  {
    titleKey: 'home.slide2Title',
    subtitleKey: 'home.slide2Subtitle',
    image: 'https://picsum.photos/seed/elma-hero-camera/800/620',
    href: '/product/sony-alpha-mirrorless-4k',
  },
  {
    titleKey: 'home.slide3Title',
    subtitleKey: 'home.slide3Subtitle',
    image: 'https://picsum.photos/seed/elma-hero-watch/800/620',
    href: '/product/apple-watch-4-2020',
  },
];

const INTERVAL_MS = 5000;

/** Auto-advancing hero carousel (Elements/Header/001). Pauses on hover/focus. */
export function HeroCarousel() {
  const t = useT();
  const count = SLIDES.length;
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);

  const go = React.useCallback((next: number) => setIndex((next + count) % count), [count]);

  React.useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, count]);

  const slide = SLIDES[index];
  if (!slide) return null;

  return (
    <section
      className="relative overflow-hidden bg-bg-muted/40"
      aria-roledescription="carousel"
      aria-label={t('home.heroEyebrow')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Container className="relative grid items-center gap-8 py-12 lg:grid-cols-2 lg:py-16">
        {/* key={index} remounts → replays the fade on each slide change */}
        <div
          key={`text-${index}`}
          className="flex animate-[elmaFade_500ms_ease-out] flex-col gap-6"
        >
          <h1 className="font-heading text-h2-alt font-bold tracking-tight text-text-primary sm:text-h2 lg:text-h1">
            {t(slide.titleKey)}
          </h1>
          <p className="max-w-md text-body-l text-text-muted">{t(slide.subtitleKey)}</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink size="lg" href={slide.href}>
              {t('common.buyNow')}
            </ButtonLink>
            <ButtonLink size="lg" variant="outline" href="/search">
              {t('home.heroCta')}
            </ButtonLink>
          </div>
        </div>
        <div className="relative">
          <img
            key={`img-${index}`}
            src={slide.image}
            alt=""
            className="aspect-[4/3] w-full animate-[elmaFade_500ms_ease-out] rounded-xl object-cover"
          />
        </div>

        {/* Prev / next */}
        <div className="absolute right-4 top-1/2 hidden -translate-y-1/2 flex-col gap-2 lg:flex">
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="flex size-9 items-center justify-center rounded-full border border-border-default bg-bg-elevated text-text-muted transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="flex size-9 items-center justify-center rounded-full border border-border-default bg-bg-elevated text-text-muted transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Dots */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 lg:left-[var(--container-px,2rem)] lg:translate-x-0">
          {SLIDES.map((s, i) => (
            <button
              key={s.titleKey}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              className={cn(
                'h-2 rounded-full transition-all',
                i === index ? 'w-6 bg-brand-solid' : 'w-2 bg-border-strong hover:bg-text-muted',
              )}
            />
          ))}
        </div>
      </Container>
    </section>
  );
}
