import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { LiveChatMessage, LiveSessionId } from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../../auth/auth.schemas';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { LiveSessionIdPipe } from '../live-params.pipe';
import { LiveChatService } from './live-chat.service';
import {
  ListLiveChatMessagesQueryDto,
  SendLiveChatMessageDto,
  SendLiveReactionDto,
} from './live-realtime.dto';
import { LiveReactionsService } from './live-reactions.service';
import { LiveSseService } from './live-sse.service';

/** Storefront realtime: SSE event stream (public), chat and reactions (any signed-in user). */
@Controller('live-sessions')
export class LiveRealtimeController {
  constructor(
    private readonly sse: LiveSseService,
    private readonly chat: LiveChatService,
    private readonly reactions: LiveReactionsService,
  ) {}

  /**
   * `text/event-stream`; 404 unless the session is SCHEDULED/LIVE; 429 over the per-IP / total
   * stream caps. `request.ip` honours `trustProxy` (main.ts).
   */
  @Get(':id/events')
  events(
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.sse.stream(id, request.ip, reply);
  }

  @Get(':id/messages')
  messages(
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Query() query: ListLiveChatMessagesQueryDto,
  ): Promise<LiveChatMessage[]> {
    return this.chat.history(id, query.limit);
  }

  /** 201 created, 200 replay of the same `clientMessageId`. */
  @Post(':id/messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: SendLiveChatMessageDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { message, isCreated } = await this.chat.send(user, id, body);
    await reply.code(isCreated ? 201 : 200).send(message);
  }

  @Post(':id/reactions')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ALL_ROLES)
  async react(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: SendLiveReactionDto,
  ): Promise<void> {
    await this.reactions.react(user, id, body.kind);
  }
}
