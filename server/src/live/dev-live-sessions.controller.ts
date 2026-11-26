import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type LiveSessionId, Role, type VendorLiveSession } from '@repo/core';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SimulateEncoderDto } from './live.dto';
import { LiveSessionIdPipe } from './live-params.pipe';
import { LiveSessionService } from './live-session.service';

/**
 * DEV ONLY — registered by LiveModule only with the fake provider outside production
 * (`devLiveRoutesEnabled`). Simulates the encoder webhook for the caller's own session.
 */
@Controller('dev/live-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF)
export class DevLiveSessionsController {
  constructor(private readonly sessions: LiveSessionService) {}

  @Post(':id/encoder')
  @HttpCode(200)
  simulateEncoder(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: SimulateEncoderDto,
  ): Promise<VendorLiveSession> {
    return this.sessions.simulateEncoder(user, id, body.connected);
  }
}
