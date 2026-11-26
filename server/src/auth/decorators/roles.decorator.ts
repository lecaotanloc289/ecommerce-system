import { SetMetadata } from '@nestjs/common';
import { type Role, RoleSchema } from '@repo/core';

export const ROLES_KEY = 'auth:roles';

/** Every role — for endpoints open to any authenticated user: `@Roles(...ALL_ROLES)`. */
export const ALL_ROLES: readonly Role[] = RoleSchema.options;

/**
 * Roles allowed to call the handler/controller (any one suffices). Enforced by RolesGuard, which
 * fails closed: a guarded route without `@Roles` is forbidden (Golden Rule #6).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
