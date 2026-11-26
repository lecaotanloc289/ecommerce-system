import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type LiveChatMessageId, type LiveSessionId, Role, type UserId } from '@repo/core';
import type { AuthUser } from '../../auth/auth.schemas';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { LiveChatMessageIdPipe, LiveSessionIdPipe, UserIdPipe } from '../live-params.pipe';
import { LiveChatService } from './live-chat.service';
import { MuteLiveUserDto } from './live-realtime.dto';

/** Chat moderation by the broadcasting vendor (owners and staff), own sessions only. */
@Controller('vendor/live-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF)
export class VendorLiveModerationController {
  constructor(private readonly chat: LiveChatService) {}

  @Post(':id/messages/:messageId/delete')
  @HttpCode(204)
  async deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Param('messageId', LiveChatMessageIdPipe) messageId: LiveChatMessageId,
  ): Promise<void> {
    await this.chat.deleteMessage(user, id, messageId);
  }

  @Post(':id/mutes')
  @HttpCode(204)
  async mute(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: MuteLiveUserDto,
  ): Promise<void> {
    await this.chat.mute(user, id, body.userId);
  }

  @Post(':id/mutes/:userId/unmute')
  @HttpCode(204)
  async unmute(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Param('userId', UserIdPipe) userId: UserId,
  ): Promise<void> {
    await this.chat.unmute(user, id, userId);
  }
}
