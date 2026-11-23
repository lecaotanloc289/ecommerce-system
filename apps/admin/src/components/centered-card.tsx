import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader } from '@repo/ui';
import { useT } from '@/i18n/use-locale';
import { LocaleSwitcher } from './locale-switcher';

/** Full-page centered card for screens outside the portal layout (login, callback, no access…). */
export function CenteredCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex min-h-svh flex-col bg-bg-surface">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <span className="font-heading text-h6 font-bold text-text-primary">
          {t('admin.appName')}
        </span>
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-md">
          <CardHeader>
            <h1 className="font-heading text-h6 font-semibold tracking-tight">{title}</h1>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          {children ? <CardContent className="flex flex-col gap-3">{children}</CardContent> : null}
        </Card>
      </main>
    </div>
  );
}
