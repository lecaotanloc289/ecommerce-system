import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type ExecutionContext, Injectable, mixin, type Type } from '@nestjs/common';
import { AuthGuard, type IAuthModuleOptions, type IAuthGuard } from '@nestjs/passport';
import { DomainError } from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthAppSchema } from '../auth.schemas';
import { clearOAuthStateCookie, readOAuthStateCookie, setOAuthStateCookie } from '../auth.http';

export type OAuthStrategyName = 'google' | 'facebook';

/**
 * Passport's redirect writes `res.statusCode`, `res.setHeader()` and `res.end()` (Node http API);
 * Fastify's reply has no such methods, so the start guard hands Passport this adapter.
 */
interface PassportRedirectResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(): void;
}

function redirectAdapter(reply: FastifyReply): PassportRedirectResponse {
  return {
    get statusCode() {
      return reply.statusCode;
    },
    set statusCode(code: number) {
      void reply.code(code);
    },
    setHeader: (name, value) => {
      void reply.header(name, value);
    },
    end: () => {
      void reply.send();
    },
  };
}

const StartQuerySchema = z.object({ app: AuthAppSchema.catch('web') }).catch({ app: 'web' });
const CallbackQuerySchema = z.object({ state: z.string().optional() });

/**
 * `GET /auth/<provider>`: generates a random OAuth `state`, binds it to the browser with an
 * HttpOnly cookie (with the requesting app), and lets Passport redirect to the provider.
 * The route handler never runs — the reply is already sent by the redirect.
 */
export function OAuthStartGuard(strategy: OAuthStrategyName): Type<IAuthGuard> {
  @Injectable()
  class StartGuard extends AuthGuard(strategy) {
    override getAuthenticateOptions(context: ExecutionContext): IAuthModuleOptions {
      const http = context.switchToHttp();
      const { app } = StartQuerySchema.parse(http.getRequest<FastifyRequest>().query);
      const state = randomBytes(32).toString('base64url');
      setOAuthStateCookie(http.getResponse<FastifyReply>(), state, app);
      return { session: false, state };
    }

    getResponse(context: ExecutionContext): PassportRedirectResponse {
      return redirectAdapter(context.switchToHttp().getResponse<FastifyReply>());
    }
  }
  return mixin(StartGuard);
}

/**
 * `GET /auth/<provider>/callback`: rejects the request unless `?state` equals the state cookie,
 * then lets Passport exchange the code and stores the normalized profile on
 * `request.oauthProfile`. Failures surface as exceptions for OAuthCallbackFilter.
 */
export function OAuthCallbackGuard(strategy: OAuthStrategyName): Type<IAuthGuard> {
  @Injectable()
  class CallbackGuard extends AuthGuard(strategy) {
    override canActivate(context: ExecutionContext) {
      const http = context.switchToHttp();
      const request = http.getRequest<FastifyRequest>();
      const expected = readOAuthStateCookie(request)?.state;
      const presented = CallbackQuerySchema.safeParse(request.query).data?.state;
      clearOAuthStateCookie(http.getResponse<FastifyReply>());
      if (!expected || !presented || !safeEqual(expected, presented)) {
        throw new DomainError('auth.error.oauth-failed');
      }
      return super.canActivate(context);
    }

    override getAuthenticateOptions(): IAuthModuleOptions {
      return { session: false, property: 'oauthProfile' };
    }
  }
  return mixin(CallbackGuard);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
