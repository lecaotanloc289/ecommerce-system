import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { oauthRedirectUrl, readOAuthStateCookie } from './auth.http';

/**
 * The OAuth callback is a browser navigation, not an XHR — so instead of a JSON error the user
 * is redirected back to the app that started the flow with `?error=auth.error.oauth-failed`
 * (state mismatch, consent denied, provider error, …). The cause is logged, never exposed.
 */
@Catch()
@Injectable()
export class OAuthCallbackFilter implements ExceptionFilter {
  private readonly logger = new Logger(OAuthCallbackFilter.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    this.logger.warn({ err: exception }, 'oauth callback failed');

    const app = readOAuthStateCookie(request)?.app ?? 'web';
    void reply.redirect(oauthRedirectUrl(this.env, app, 'auth.error.oauth-failed'), 302);
  }
}
