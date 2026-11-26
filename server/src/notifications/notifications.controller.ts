import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Notification, UnreadCount } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  NotificationDto,
  NotificationPageDto,
  NotificationPageQueryDto,
  NotificationParamsDto,
  UnreadCountDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/** The signed-in user's own in-app notifications (ownership always from the JWT). */
@ApiTags('notifications')
@ApiBearerAuth(BEARER_AUTH)
@Controller('me/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ALL_ROLES)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({ summary: 'Own notifications, newest first (cursor)' })
  @ZodResponse({ status: 200, description: 'One page', type: NotificationPageDto })
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationPageQueryDto) {
    return this.notifications.list(user.id, query);
  }

  @ApiOperation({ summary: 'Number of unread notifications' })
  @ZodResponse({ status: 200, description: 'Unread count', type: UnreadCountDto })
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCount> {
    return this.notifications.unreadCount(user.id);
  }

  @ApiOperation({ summary: 'Mark all own notifications read' })
  @ApiNoContentResponse({ description: 'Marked' })
  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: AuthUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @ApiOperation({
    summary: 'Mark one own notification read (idempotent)',
    description: "Another user's or unknown id → 404 `notification.error.not-found`.",
  })
  @ZodResponse({ status: 200, description: 'The notification', type: NotificationDto })
  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param() params: NotificationParamsDto,
  ): Promise<Notification> {
    return this.notifications.markRead(user.id, params.id);
  }
}
