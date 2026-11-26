import { Body, Controller, Get, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformSettings } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { PlatformSettingsDto, PlatformSettingsUpdateDto } from './platform.dto';
import { IDEMPOTENCY_HEADER } from './platform.headers';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @ApiOperation({ summary: 'Platform tunables (commission, hold period, currencies, …)' })
  @ZodResponse({ status: 200, description: 'The settings row', type: PlatformSettingsDto })
  @Get()
  @Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
  get(): Promise<PlatformSettings> {
    return this.settings.get();
  }

  @ApiOperation({
    summary: 'Change any subset of the tunables (admin only)',
    description:
      'Bounds: commissionBps 0..10000, holdPeriodDays / refundWindowDays 0..365, ' +
      'paymentTimeoutMinutes 5..1440, maxCouponStack 1..10, non-empty supportedCurrencies that ' +
      'contains defaultCurrency (checked against the stored values when only one is sent).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The updated settings', type: PlatformSettingsDto })
  @Patch()
  @HttpCode(200)
  @Roles('PLATFORM_ADMIN')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: PlatformSettingsUpdateDto,
  ): Promise<PlatformSettings> {
    return this.settings.update(user.id, body);
  }
}
