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
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DomainError } from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodResponse } from 'nestjs-zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { BEARER_AUTH, REFRESH_COOKIE_AUTH } from '../openapi/openapi';
import { MeResponseDto, TokenResponseDto } from './auth.dto';
import {
  clearRefreshCookie,
  oauthRedirectUrl,
  readOAuthStateCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth.http';
import type { AuthUser, MeResponse, OAuthProfile, TokenResponse } from './auth.schemas';
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
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @ApiOperation({ summary: 'Start Google OAuth login (browser navigation, not an XHR call)' })
  @ApiQuery({ name: 'app', enum: ['web', 'admin'], required: false })
  @ApiResponse({ status: 302, description: 'Redirect to Google' })
  @Get('google')
  @UseGuards(OAuthStartGuard('google'))
  googleStart(): void {
    // OAuthStartGuard redirects to Google; never reached.
  }

  @ApiOperation({ summary: 'Google OAuth callback (browser redirect, not an XHR call)' })
  @ApiResponse({
    status: 302,
    description: 'Sets the refresh cookie and redirects to the app (`?error=...` on failure)',
  })
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

  @ApiOperation({ summary: 'Start Facebook OAuth login (browser navigation, not an XHR call)' })
  @ApiQuery({ name: 'app', enum: ['web', 'admin'], required: false })
  @ApiResponse({ status: 302, description: 'Redirect to Facebook' })
  @Get('facebook')
  @UseGuards(OAuthStartGuard('facebook'))
  facebookStart(): void {
    // OAuthStartGuard redirects to Facebook; never reached.
  }

  @ApiOperation({ summary: 'Facebook OAuth callback (browser redirect, not an XHR call)' })
  @ApiResponse({
    status: 302,
    description: 'Sets the refresh cookie and redirects to the app (`?error=...` on failure)',
  })
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
  @ApiOperation({ summary: 'Rotate the refresh cookie and return a new access token' })
  @ApiCookieAuth(REFRESH_COOKIE_AUTH)
  @ZodResponse({ status: 200, description: 'New access token', type: TokenResponseDto })
  @Post('refresh')
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
  @ApiOperation({ summary: 'Revoke the session and clear the refresh cookie' })
  @ApiCookieAuth(REFRESH_COOKIE_AUTH)
  @ApiNoContentResponse({ description: 'Session revoked (idempotent)' })
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

  @ApiOperation({ summary: 'Current user profile, effective roles and vendor id' })
  @ApiBearerAuth(BEARER_AUTH)
  @ZodResponse({ status: 200, description: 'Current user', type: MeResponseDto })
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
