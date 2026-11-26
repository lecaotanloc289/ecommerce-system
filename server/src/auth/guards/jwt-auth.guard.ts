import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '@repo/core';
import type { FastifyRequest } from 'fastify';
import { TokenService } from '../token.service';

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Verifies `Authorization: Bearer <access JWT>` (via @nestjs/jwt) and sets `request.user`.
 * Missing header → `common.error.unauthorized`; bad/expired token → `auth.error.token-*`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new DomainError('common.error.unauthorized');

    const claims = await this.tokens.verifyAccessToken(token);
    request.user = {
      id: claims.sub,
      roles: claims.roles,
      ...(claims.vendorId !== undefined && { vendorId: claims.vendorId }),
    };
    return true;
  }
}
