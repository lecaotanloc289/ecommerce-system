import { NavLink } from 'react-router';
import { cn } from '@repo/ui';
import { useCurrentUser } from '@/auth/session';
import { useT } from '@/i18n/use-locale';
import { visiblePages, type PortalConfig } from '@/router/portals';

/** Portal links the current user may open (role-restricted entries are omitted, not disabled). */
export function SidebarNav({
  config,
  onNavigate,
}: {
  config: PortalConfig;
  onNavigate?: () => void;
}) {
  const t = useT();
  const user = useCurrentUser();
  return (
    <nav aria-label={t('admin.nav.mainNavigation')} className="flex flex-col gap-1">
      {visiblePages(config, user.roles).map(({ path, labelKey, icon: Icon }) => (
        <NavLink
          key={path}
          to={path ? `${config.basePath}/${path}` : config.basePath}
          end={path === ''}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-body-s font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
              isActive
                ? 'bg-brand-soft text-brand-text'
                : 'text-text-body hover:bg-bg-muted hover:text-text-primary',
            )
          }
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}
