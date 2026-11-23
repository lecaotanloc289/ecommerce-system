import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VendorPreference } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { RateLimit } from '../common/rate-limit';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  UnsubscribeDto,
  UpdateVendorPreferenceDto,
  VendorPreferenceDto,
  VendorPreferenceListDto,
  VendorPreferenceParamsDto,
} from './crm-consent.dto';
import { CrmConsentService } from './crm-consent.service';

@ApiTags('crm-consent')
@ApiBearerAuth(BEARER_AUTH)
@Controller('me/vendor-preferences')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorPreferencesController {
  constructor(private readonly consent: CrmConsentService) {}

  @ApiOperation({
    summary: 'Shops the user bought from (or has a preference with) + consent state',
  })
  @ZodResponse({ status: 200, description: 'Preferences', type: VendorPreferenceListDto })
  @Get()
  @Roles(...ALL_ROLES)
  list(@CurrentUser() user: AuthUser): Promise<VendorPreference[]> {
    return this.consent.list(user.id);
  }

  @ApiOperation({
    summary: 'Opt in/out of a shop’s marketing and service messages',
    description:
      'Only for a shop the caller bought from or already has a preference with, else 404 ' +
      '`vendor.error.not-found`. Already-in-state changes are no-ops (no consent event).',
  })
  @ZodResponse({ status: 200, description: 'Updated preference', type: VendorPreferenceDto })
  @Put(':vendorId')
  @Roles('CUSTOMER')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorPreferenceParamsDto,
    @Body() body: UpdateVendorPreferenceDto,
  ): Promise<VendorPreference> {
    return this.consent.update(user.id, params.vendorId, body);
  }
}

@ApiTags('crm-consent')
@Controller('crm/unsubscribe')
export class CrmUnsubscribeController {
  constructor(private readonly consent: CrmConsentService) {}

  @ApiOperation({
    summary: 'Unsubscribe from a shop via the emailed token (public, idempotent)',
    description: 'Unknown token → 404 `crm.error.unsubscribe-invalid`.',
  })
  @ApiNoContentResponse({ description: 'Unsubscribed (or already was)' })
  @Post()
  @HttpCode(204)
  @RateLimit('unsubscribe')
  unsubscribe(@Body() body: UnsubscribeDto): Promise<void> {
    return this.consent.unsubscribe(body);
  }
}
