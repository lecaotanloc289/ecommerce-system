import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { OAuthCallbackFilter } from './oauth-callback.filter';
import { RefreshTokenStore } from './refresh-token.store';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { TokenService } from './token.service';

/**
 * Import AuthModule in any feature module that protects routes, then
 * `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(...)`.
 */
@Module({
  // Secrets/TTLs are passed per call (access vs refresh), so JwtModule has no defaults.
  imports: [PassportModule.register({ session: false }), JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenStore,
    GoogleStrategy,
    FacebookStrategy,
    JwtAuthGuard,
    RolesGuard,
    OAuthCallbackFilter,
  ],
  exports: [AuthService, TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
