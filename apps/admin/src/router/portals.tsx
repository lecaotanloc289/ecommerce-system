import type { ReactNode } from 'react';
import {
  FileCheck,
  LayoutDashboard,
  Package,
  RotateCcw,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@repo/core';
import type { MessageKey } from '@repo/i18n';
import {
  hasAnyRole,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_ROLES,
  VENDOR_OWNER_ROLES,
  VENDOR_ROLES,
  type Portal,
} from '@/auth/roles';
import { ApplicationsPage } from '@/pages/platform/applications-page';
import { OrdersPage } from '@/pages/platform/orders-page';
import { PlatformDashboardPage } from '@/pages/platform/platform-dashboard-page';
import { ProductsPage } from '@/pages/platform/products-page';
import { RefundsPage } from '@/pages/platform/refunds-page';
import { SettingsPage } from '@/pages/platform/settings-page';
import { UsersPage } from '@/pages/platform/users-page';
import { VendorsPage } from '@/pages/platform/vendors-page';
import { OrderDetailPage } from '@/pages/vendor/order-detail-page';
import { OrdersPage as VendorOrdersPage } from '@/pages/vendor/orders-page';
import { ProductEditPage } from '@/pages/vendor/product-edit-page';
import { ProductsPage as VendorProductsPage } from '@/pages/vendor/products-page';
import { ShippingPage } from '@/pages/vendor/shipping-page';
import { StaffPage } from '@/pages/vendor/staff-page';
import { VendorDashboardPage } from '@/pages/vendor/vendor-dashboard-page';
import { WalletPage } from '@/pages/vendor/wallet-page';

/**
 * One entry = one sidebar link + one route under the portal. `roles` narrows access within the
 * portal: the link is hidden and the route redirects to the portal dashboard for everyone else.
 * To build a real page (T5.3 / T5.4), replace its `element` — nothing else needs to change.
 */
export interface PortalPage {
  /** Relative to the portal base; `''` is the dashboard (index route). */
  path: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  roles?: readonly Role[];
  element: ReactNode;
}

/** A route under the portal that has no sidebar link (detail / edit pages, `products/:id`). */
export interface PortalSubRoute {
  path: string;
  roles?: readonly Role[];
  element: ReactNode;
}

export interface PortalConfig {
  portal: Portal;
  basePath: `/${Portal}`;
  titleKey: MessageKey;
  roles: readonly Role[];
  pages: readonly PortalPage[];
  subRoutes?: readonly PortalSubRoute[];
}

export const VENDOR_PORTAL: PortalConfig = {
  portal: 'vendor',
  basePath: '/vendor',
  titleKey: 'admin.portal.vendor',
  roles: VENDOR_ROLES,
  pages: [
    {
      path: '',
      labelKey: 'admin.nav.dashboard',
      icon: LayoutDashboard,
      element: <VendorDashboardPage />,
    },
    {
      path: 'products',
      labelKey: 'admin.nav.products',
      icon: Package,
      element: <VendorProductsPage />,
    },
    {
      path: 'orders',
      labelKey: 'admin.nav.orders',
      icon: ShoppingBag,
      element: <VendorOrdersPage />,
    },
    { path: 'shipping', labelKey: 'admin.nav.shipping', icon: Truck, element: <ShippingPage /> },
    {
      path: 'wallet',
      labelKey: 'admin.nav.wallet',
      icon: Wallet,
      roles: VENDOR_OWNER_ROLES,
      element: <WalletPage />,
    },
    {
      path: 'staff',
      labelKey: 'admin.nav.staff',
      icon: Users,
      roles: VENDOR_OWNER_ROLES,
      element: <StaffPage />,
    },
  ],
  subRoutes: [
    { path: 'products/new', element: <ProductEditPage /> },
    { path: 'products/:id', element: <ProductEditPage /> },
    { path: 'orders/:id', element: <OrderDetailPage /> },
  ],
};

export const PLATFORM_PORTAL: PortalConfig = {
  portal: 'platform',
  basePath: '/platform',
  titleKey: 'admin.portal.platform',
  roles: PLATFORM_ROLES,
  pages: [
    {
      path: '',
      labelKey: 'admin.nav.dashboard',
      icon: LayoutDashboard,
      element: <PlatformDashboardPage />,
    },
    {
      path: 'applications',
      labelKey: 'admin.nav.applications',
      icon: FileCheck,
      element: <ApplicationsPage />,
    },
    { path: 'vendors', labelKey: 'admin.nav.vendors', icon: Store, element: <VendorsPage /> },
    { path: 'products', labelKey: 'admin.nav.products', icon: Package, element: <ProductsPage /> },
    { path: 'orders', labelKey: 'admin.nav.orders', icon: ShoppingBag, element: <OrdersPage /> },
    { path: 'refunds', labelKey: 'admin.nav.refunds', icon: RotateCcw, element: <RefundsPage /> },
    {
      path: 'settings',
      labelKey: 'admin.nav.settings',
      icon: Settings,
      roles: PLATFORM_ADMIN_ROLES,
      element: <SettingsPage />,
    },
    {
      path: 'users',
      labelKey: 'admin.nav.users',
      icon: UserCog,
      roles: PLATFORM_ADMIN_ROLES,
      element: <UsersPage />,
    },
  ],
};

export const PORTALS: Readonly<Record<Portal, PortalConfig>> = {
  vendor: VENDOR_PORTAL,
  platform: PLATFORM_PORTAL,
};

/** Pages of `config` this user may open — drives the sidebar. */
export function visiblePages(config: PortalConfig, userRoles: readonly Role[]): PortalPage[] {
  return config.pages.filter((page) => !page.roles || hasAnyRole(userRoles, page.roles));
}
