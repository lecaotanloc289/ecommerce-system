'use client';

import { Button } from '@repo/ui';
import { translateError } from '@repo/i18n';
import { Container } from '@/components/layout/container';
import { ButtonLink } from '@/components/common/button-link';
import { useLocale } from '@/i18n/use-locale';

/**
 * Error boundary for `[locale]` pages — e.g. the API is down or answered 5xx/429 during SSR
 * (`ApiError` from `lib/api/server.ts`; a 404 renders not-found instead). Server error details
 * are not exposed to the browser in production, so this shows a generic message.
 */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const { locale, t } = useLocale();
  return (
    <Container as="section" className="flex flex-col items-center py-16 text-center lg:py-24">
      <h1 className="font-heading text-h3 font-bold tracking-tight text-text-primary">
        {t('common.errorTitle')}
      </h1>
      <p className="mt-4 max-w-lg text-body-l text-text-muted">
        {translateError(locale, 'common.error.internal')}
      </p>
      <div className="mt-8 flex gap-3">
        <Button variant="primary" size="md" onClick={reset}>
          {t('common.retry')}
        </Button>
        <ButtonLink href="/" variant="outline" size="md">
          {t('common.home')}
        </ButtonLink>
      </div>
    </Container>
  );
}
