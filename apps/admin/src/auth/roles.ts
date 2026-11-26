import type { MessageKey } from '@repo/i18n';
import type { Role } from '@repo/core';

export const VENDOR_ROLES = ['VENDOR_OWNER', 'VENDOR_STAFF'] as const satisfies readonly Role[];
export const PLATFORM_ROLES = [
  'PLATFORM_STAFF',
  'PLATFORM_ADMIN',
] as const satisfies readonly Role[];
/** Owner-only vendor pages (wallet, staff) — hidden from VENDOR_STAFF. */
export const VENDOR_OWNER_ROLES = ['VENDOR_OWNER'] as const satisfies readonly Role[];
/** Admin-only platform pages (settings, users) — hidden from PLATFORM_STAFF. */
export const PLATFORM_ADMIN_ROLES = ['PLATFORM_ADMIN'] as const satisfies readonly Role[];

export type Portal = 'vendor' | 'platform';

export function hasAnyRole(userRoles: readonly Role[], allowed: readonly Role[]): boolean {
  return allowed.some((role) => userRoles.includes(role));
}

/** Workspaces this user may open, in display order. Empty → "no access" page. */
export function portalsFor(userRoles: readonly Role[]): Portal[] {
  const portals: Portal[] = [];
  if (hasAnyRole(userRoles, VENDOR_ROLES)) portals.push('vendor');
  if (hasAnyRole(userRoles, PLATFORM_ROLES)) portals.push('platform');
  return portals;
}

export const ROLE_LABEL_KEYS: Readonly<Record<Role, MessageKey>> = {
  GUEST: 'admin.role.guest',
  CUSTOMER: 'admin.role.customer',
  VENDOR_OWNER: 'admin.role.vendorOwner',
  VENDOR_STAFF: 'admin.role.vendorStaff',
  PLATFORM_STAFF: 'admin.role.platformStaff',
  PLATFORM_ADMIN: 'admin.role.platformAdmin',
};
