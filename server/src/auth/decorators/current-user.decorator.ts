import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '@repo/core';
import type { FastifyRequest } from 'fastify';
import type { AuthUser, OAuthProfile } from '../auth.schemas';

export function currentUserFactory(_data: unknown, context: ExecutionContext): AuthUser {
  const user = context.switchToHttp().getRequest<FastifyRequest>().user;
  if (!user) throw new DomainError('common.error.unauthorized');
  return user;
}

export function oauthProfileFactory(_data: unknown, context: ExecutionContext): OAuthProfile {
  const profile = context.switchToHttp().getRequest<FastifyRequest>().oauthProfile;
  if (!profile) throw new DomainError('auth.error.oauth-failed');
  return profile;
}

/** The authenticated user set by JwtAuthGuard. Use only on routes guarded by it. */
export const CurrentUser = createParamDecorator(currentUserFactory);

/** The provider profile set by OAuthCallbackGuard. */
export const CurrentOAuthProfile = createParamDecorator(oauthProfileFactory);
