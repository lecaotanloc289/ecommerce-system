import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, type Role } from '@repo/core';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Allows the request when `request.user` holds at least one of the `@Roles(...)` declared on the
 * handler (or, failing that, the controller). Fails closed: no `@Roles` → forbidden, so a
 * forgotten declaration can't expose a route; use `@Roles(...ALL_ROLES)` for "any signed-in user".
 * Must run after JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user) throw new DomainError('common.error.unauthorized');

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.some((role) => user.roles.includes(role))) return true;
    throw new DomainError('common.error.forbidden');
  }
}
