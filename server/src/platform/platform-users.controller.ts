import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformUser, PlatformUserPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  PlatformRoleGrantDto,
  PlatformUserDto,
  PlatformUserListQueryDto,
  PlatformUserPageDto,
  PlatformUserParamsDto,
  PlatformUserRoleParamsDto,
} from './platform.dto';
import { IDEMPOTENCY_HEADER } from './platform.headers';
import { PlatformUsersService } from './platform-users.service';

@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @ApiOperation({ summary: 'Users, newest first; `q` matches email or name' })
  @ZodResponse({ status: 200, description: 'One page', type: PlatformUserPageDto })
  @Get()
  @Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
  list(@Query() query: PlatformUserListQueryDto): Promise<PlatformUserPage> {
    return this.users.list(query);
  }

  @ApiOperation({
    summary: 'Grant PLATFORM_STAFF / PLATFORM_ADMIN (admin only)',
    description:
      'The user sees the role from their next access-token refresh. Already held: no-op.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The user', type: PlatformUserDto })
  @Post(':id/roles')
  @HttpCode(200)
  @Roles('PLATFORM_ADMIN')
  @Idempotent()
  grant(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformUserParamsDto,
    @Body() body: PlatformRoleGrantDto,
  ): Promise<PlatformUser> {
    return this.users.grant(user.id, params.id, body.role);
  }

  @ApiOperation({
    summary: 'Revoke PLATFORM_STAFF / PLATFORM_ADMIN (admin only)',
    description:
      'An admin cannot remove their own PLATFORM_ADMIN (403 `common.error.forbidden`); the last ' +
      'admin cannot be removed (409 `common.error.conflict`). Not held: no-op.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The user', type: PlatformUserDto })
  @Delete(':id/roles/:role')
  @HttpCode(200)
  @Roles('PLATFORM_ADMIN')
  @Idempotent()
  revoke(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformUserRoleParamsDto,
  ): Promise<PlatformUser> {
    return this.users.revoke(user.id, params.id, params.role);
  }
}
