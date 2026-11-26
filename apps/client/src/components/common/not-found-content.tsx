'use client';

import { translateError } from '@repo/i18n';
import { ButtonLink } from './button-link';
import { Container } from '../layout/container';
import { useLocale } from '@/i18n/use-locale';

/** Localized 404 body (rendered inside `StorefrontShell`). */
export function NotFoundContent() {
  const { locale, t } = useLocale();
  return (
    <Container as="section" className="flex flex-col items-center py-16 text-center lg:py-24">
      <h1 className="font-heading text-h2 font-bold tracking-tight text-text-primary">404</h1>
      <p className="mt-4 max-w-lg text-body-l text-text-muted">
        {translateError(locale, 'common.error.not-found')}
      </p>
      <ButtonLink href="/" variant="outline" size="md" className="mt-8">
        {t('common.home')}
      </ButtonLink>
    </Container>
  );
}
