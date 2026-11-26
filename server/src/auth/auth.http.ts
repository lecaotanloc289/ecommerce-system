import type {} from '@fastify/cookie';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import { type AuthApp, AuthAppSchema } from './auth.schemas';

/** Cookies are scoped to the auth routes so they are never sent to the rest of the API. */
const AUTH_COOKIE_PATH = '/v1/auth';

export const REFRESH_COOKIE = 'refresh_token';
export const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const baseCookie: CookieSerializeOptions = {
  path: AUTH_COOKIE_PATH,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

export function setRefreshCookie(reply: FastifyReply, token: string, env: Env): void {
  reply.setCookie(REFRESH_COOKIE, token, { ...baseCookie, maxAge: env.JWT_REFRESH_TTL });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, baseCookie);
}

export function readRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE] || undefined;
}

/** OAuth `state` is bound to the browser via this cookie (login-CSRF protection). */
export function setOAuthStateCookie(reply: FastifyReply, state: string, app: AuthApp): void {
  reply.setCookie(OAUTH_STATE_COOKIE, `${state}.${app}`, {
    ...baseCookie,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, baseCookie);
}

export function readOAuthStateCookie(
  request: FastifyRequest,
): { state: string; app: AuthApp } | null {
  const raw = request.cookies[OAUTH_STATE_COOKIE];
  if (!raw) return null;
  const [state, app] = raw.split('.');
  const parsedApp = AuthAppSchema.safeParse(app);
  if (!state || !parsedApp.success) return null;
  return { state, app: parsedApp.data };
}

/** Post-login landing page for the app that started the flow; `error` is an i18n errorCode. */
export function oauthRedirectUrl(env: Env, app: AuthApp, error?: string): string {
  const url = new URL(app === 'admin' ? env.AUTH_REDIRECT_URL_ADMIN : env.AUTH_REDIRECT_URL_WEB);
  if (error) url.searchParams.set('error', error);
  return url.toString();
}
