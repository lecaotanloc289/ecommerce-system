import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { DomainError, type MeResponse, type TokenResponse } from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  clearRefreshCookie,
  oauthRedirectUrl,
  readOAuthStateCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth.http';
import type { AuthUser, OAuthProfile } from './auth.schemas';
import { AuthService } from './auth.service';
import { CurrentOAuthProfile, CurrentUser } from './decorators/current-user.decorator';
import { ALL_ROLES, Roles } from './decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OAuthCallbackGuard, OAuthStartGuard } from './guards/oauth.guards';
import { RolesGuard } from './guards/roles.guard';
import { OAuthCallbackFilter } from './oauth-callback.filter';
import { TokenService } from './token.service';

/**
 * OAuth only (Golden Rule #5). Login = browser navigation to `/auth/<provider>?app=web|admin`;
 * the callback sets the refresh cookie and redirects to the app, which then calls
 * `POST /auth/refresh` to obtain its in-memory access token.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('google')
  @UseGuards(OAuthStartGuard('google'))
  googleStart(): void {
    // OAuthStartGuard redirects to Google; never reached.
  }

  @Get('google/callback')
  @UseGuards(OAuthCallbackGuard('google'))
  @UseFilters(OAuthCallbackFilter)
  googleCallback(
    @CurrentOAuthProfile() profile: OAuthProfile,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.completeOAuthLogin(profile, request, reply);
  }

  @Get('facebook')
  @UseGuards(OAuthStartGuard('facebook'))
  facebookStart(): void {
    // OAuthStartGuard redirects to Facebook; never reached.
  }

  @Get('facebook/callback')
  @UseGuards(OAuthCallbackGuard('facebook'))
  @UseFilters(OAuthCallbackFilter)
  facebookCallback(
    @CurrentOAuthProfile() profile: OAuthProfile,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.completeOAuthLogin(profile, request, reply);
  }

  /** Rotates the refresh cookie and returns a fresh access token. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    const presented = readRefreshCookie(request);
    if (!presented) throw new DomainError('auth.error.token-invalid');
    try {
      const session = await this.tokens.rotate(presented);
      if (session.refreshToken) setRefreshCookie(reply, session.refreshToken, this.env);
      return session.access;
    } catch (error) {
      // A rejected token is dead — drop the cookie. Infra errors keep it so the client can retry.
      if (error instanceof DomainError) clearRefreshCookie(reply);
      throw error;
    }
  }

  /** Revokes the session (token family) and clears the cookie. Idempotent. */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const presented = readRefreshCookie(request);
    if (presented) await this.tokens.revoke(presented);
    clearRefreshCookie(reply);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.getMe(user.id);
  }

  private async completeOAuthLogin(
    profile: OAuthProfile,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const refreshToken = await this.auth.loginWithOAuth(profile);
    setRefreshCookie(reply, refreshToken, this.env);
    const app = readOAuthStateCookie(request)?.app ?? 'web';
    await reply.redirect(oauthRedirectUrl(this.env, app), 302);
  }
}
