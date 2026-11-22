'use client';

import { Link } from '@/i18n/navigation';
import { Card } from '@repo/ui';
import { Container } from '@/components/layout/container';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { PromoAside } from '@/components/auth/promo-aside';
import { useT } from '@/i18n/use-locale';

export default function SignInPage() {
  const t = useT();
  return (
    <Container as="section" className="py-12 lg:py-20">
      <div className="mx-auto grid max-w-4xl items-stretch gap-8 lg:grid-cols-[1fr_420px]">
        <Card className="flex flex-col gap-5 p-6 lg:p-8">
          <div className="flex items-center justify-between">
            <h1 className="font-heading text-h4 font-bold tracking-tight text-text-primary">
              {t('auth.signInTitle')}
            </h1>
            <Link
              href="/register"
              className="text-body-s font-medium text-brand-text hover:underline"
            >
              {t('auth.registerHere')} ›
            </Link>
          </div>

          {/* OAuth only — Golden Rule #5 (no email/password flow exists) */}
          <OAuthButtons />
          <p className="text-body-s text-text-muted">{t('auth.oauthNote')}</p>
        </Card>

        <PromoAside title="auth.promoSigninTitle" body="auth.promoSigninBody" seed="elma-signin" />
      </div>
    </Container>
  );
}
