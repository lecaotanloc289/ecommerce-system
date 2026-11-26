import { ChevronRight, Store, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { portalsFor, type Portal } from '@/auth/roles';
import { useCurrentUser } from '@/auth/session';
import { CenteredCard } from '@/components/centered-card';
import { SignOutButton } from '@/components/sign-out-button';
import { useT, type MessageKey } from '@/i18n/use-locale';
import { PORTALS } from '@/router/portals';

const PORTAL_CARD: Readonly<Record<Portal, { icon: LucideIcon; descriptionKey: MessageKey }>> = {
  vendor: { icon: Store, descriptionKey: 'admin.chooser.vendorDesc' },
  platform: { icon: ShieldCheck, descriptionKey: 'admin.chooser.platformDesc' },
};

/** `/`: one portal → go there; both → chooser; none (customer only) → no access. */
export function HomePage() {
  const user = useCurrentUser();
  const portals = portalsFor(user.roles);
  const [only] = portals;

  if (portals.length === 0) return <NoAccess />;
  if (portals.length === 1 && only) return <Navigate to={PORTALS[only].basePath} replace />;
  return <PortalChooser portals={portals} />;
}

function NoAccess() {
  const t = useT();
  return (
    <CenteredCard title={t('admin.noAccess.title')} description={t('admin.noAccess.description')}>
      <SignOutButton fullWidth />
    </CenteredCard>
  );
}

function PortalChooser({ portals }: { portals: readonly Portal[] }) {
  const t = useT();
  return (
    <CenteredCard title={t('admin.chooser.title')} description={t('admin.chooser.description')}>
      <nav className="flex flex-col gap-3">
        {portals.map((portal) => {
          const { icon: Icon, descriptionKey } = PORTAL_CARD[portal];
          return (
            <Link
              key={portal}
              to={PORTALS[portal].basePath}
              className="flex items-center gap-3 rounded-md border border-border-subtle p-4 transition-colors hover:border-border-strong hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <Icon className="size-6 shrink-0 text-brand-text" aria-hidden />
              <span className="flex flex-1 flex-col">
                <span className="text-body-m font-semibold text-text-primary">
                  {t(PORTALS[portal].titleKey)}
                </span>
                <span className="text-body-s text-text-muted">{t(descriptionKey)}</span>
              </span>
              <ChevronRight className="size-4 text-text-muted" aria-hidden />
            </Link>
          );
        })}
      </nav>
      <SignOutButton variant="link" className="self-center" />
    </CenteredCard>
  );
}
