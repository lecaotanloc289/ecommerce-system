import { useState } from 'react';
import { ArrowLeftRight, Menu } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import {
  Button,
  buttonVariants,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@repo/ui';
import { portalsFor } from '@/auth/roles';
import { useCurrentUser } from '@/auth/session';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useT } from '@/i18n/use-locale';
import type { PortalConfig } from '@/router/portals';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

/**
 * Shell for `/vendor/*` and `/platform/*`: fixed sidebar on desktop, drawer on mobile, topbar with
 * workspace switch (dual-role users), locale switcher and user menu.
 */
export function PortalLayout({ config }: { config: PortalConfig }) {
  const t = useT();
  const user = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const canSwitch = portalsFor(user.roles).length > 1;

  const brand = (
    <div className="flex flex-col">
      <span className="font-heading text-h7 font-bold text-text-primary">{t('admin.appName')}</span>
      <span className="text-caption text-text-muted">{t(config.titleKey)}</span>
    </div>
  );

  return (
    <div className="flex min-h-svh bg-bg-surface">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r border-border-subtle bg-bg-elevated p-4 md:flex">
        {brand}
        <SidebarNav config={config} />
      </aside>

      <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
        <DrawerContent side="left" className="w-72 md:hidden">
          <DrawerTitle className="sr-only">{t('admin.nav.mainNavigation')}</DrawerTitle>
          <DrawerDescription className="sr-only">{t(config.titleKey)}</DrawerDescription>
          {brand}
          <SidebarNav config={config} onNavigate={() => setMenuOpen(false)} />
        </DrawerContent>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border-subtle bg-bg-elevated px-3 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('admin.nav.openMenu')}
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden />
          </Button>
          <span className="truncate text-body-m font-semibold text-text-primary md:hidden">
            {t(config.titleKey)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {canSwitch ? (
              // Not `<Button asChild>`: @repo/ui Button renders icon slots next to the child, which
              // Radix Slot rejects (React.Children.only).
              <Link
                to="/"
                aria-label={t('admin.portal.switch')}
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                <ArrowLeftRight aria-hidden />
                <span className="hidden lg:inline">{t('admin.portal.switch')}</span>
              </Link>
            ) : null}
            <LocaleSwitcher />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
