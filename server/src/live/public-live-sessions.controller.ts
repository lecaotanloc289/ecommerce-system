import { Controller, Get, Param, Query } from '@nestjs/common';
import type { LiveSession, LiveSessionId } from '@repo/core';
import { ListLiveSessionsQueryDto } from './live.dto';
import { LiveSessionIdPipe } from './live-params.pipe';
import { LiveSessionService } from './live-session.service';

/** Storefront reads — no auth. */
@Controller('live-sessions')
export class PublicLiveSessionsController {
  constructor(private readonly sessions: LiveSessionService) {}

  @Get()
  list(@Query() query: ListLiveSessionsQueryDto): Promise<LiveSession[]> {
    return this.sessions.listPublic(query.status);
  }

  @Get(':id')
  get(@Param('id', LiveSessionIdPipe) id: LiveSessionId): Promise<LiveSession> {
    return this.sessions.getPublic(id);
  }
}
