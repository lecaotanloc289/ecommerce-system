import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformVendor, PlatformVendorPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  PlatformVendorDto,
  PlatformVendorListQueryDto,
  PlatformVendorPageDto,
  PlatformVendorParamsDto,
  PlatformVendorSuspendDto,
} from './platform.dto';
import { IDEMPOTENCY_HEADER } from './platform.headers';
import { PlatformVendorsService } from './platform-vendors.service';

@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/vendors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformVendorsController {
  constructor(private readonly vendors: PlatformVendorsService) {}

  @ApiOperation({ summary: 'Vendors, newest first; filter by `status`, search `q`' })
  @ZodResponse({ status: 200, description: 'One page', type: PlatformVendorPageDto })
  @Get()
  list(@Query() query: PlatformVendorListQueryDto): Promise<PlatformVendorPage> {
    return this.vendors.list(query);
  }

  @ApiOperation({
    summary: 'Suspend an ACTIVE vendor (staff or admin)',
    description:
      'Its products leave the catalog, cart and checkout and its writes are refused with ' +
      '`vendor.error.suspended` at once. Not ACTIVE → 409 `common.error.conflict`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The vendor', type: PlatformVendorDto })
  @Post(':id/suspend')
  @HttpCode(200)
  @Idempotent()
  suspend(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformVendorParamsDto,
    @Body() body: PlatformVendorSuspendDto,
  ): Promise<PlatformVendor> {
    return this.vendors.suspend(user.id, params.id, body.reason);
  }

  @ApiOperation({
    summary: 'Reactivate a SUSPENDED vendor (staff or admin)',
    description: 'Not SUSPENDED → 409 `common.error.conflict`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The vendor', type: PlatformVendorDto })
  @Post(':id/reactivate')
  @HttpCode(200)
  @Idempotent()
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformVendorParamsDto,
  ): Promise<PlatformVendor> {
    return this.vendors.reactivate(user.id, params.id);
  }
}
