import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { type LiveSessionId, Role, type VendorLiveSession } from '@repo/core';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListLiveSessionsQueryDto, TerminateLiveSessionDto } from './live.dto';
import { LiveSessionIdPipe } from './live-params.pipe';
import { LiveSessionService } from './live-session.service';

/** Platform moderation across all vendors. */
@Controller('platform/live-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PLATFORM_STAFF, Role.PLATFORM_ADMIN)
export class PlatformLiveSessionsController {
  constructor(private readonly sessions: LiveSessionService) {}

  @Get()
  list(@Query() query: ListLiveSessionsQueryDto): Promise<VendorLiveSession[]> {
    return this.sessions.listForPlatform(query.status);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  terminate(
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: TerminateLiveSessionDto,
  ): Promise<VendorLiveSession> {
    return this.sessions.terminate(id, body.reason);
  }
}
