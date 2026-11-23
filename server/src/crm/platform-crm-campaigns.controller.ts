import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CrmCampaign, CrmCampaignPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { IDEMPOTENCY_HEADER } from '../platform/platform.headers';
import { CrmCampaignsService } from './crm-campaigns.service';
import {
  CancelCrmCampaignDto,
  CrmCampaignDto,
  CrmCampaignPageDto,
  CrmCampaignParamsDto,
  PlatformCrmCampaignListQueryDto,
} from './crm.dto';

/** Platform oversight of vendor CRM campaigns (C13: anti-abuse). */
@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/crm/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformCrmCampaignsController {
  constructor(private readonly campaigns: CrmCampaignsService) {}

  @ApiOperation({ summary: 'All vendors’ campaigns, newest first; filter `vendorId`, `status`' })
  @ZodResponse({ status: 200, description: 'One page', type: CrmCampaignPageDto })
  @Get()
  list(@Query() query: PlatformCrmCampaignListQueryDto): Promise<CrmCampaignPage> {
    return this.campaigns.platformList(query);
  }

  @ApiOperation({
    summary: 'Cancel a DRAFT / SCHEDULED campaign with a reason',
    description:
      'Unknown → 404 `crm.error.campaign-not-found`; other status → 409 ' +
      '`crm.error.campaign-not-editable`. Pending messages become SKIPPED (CAMPAIGN_CANCELLED).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The cancelled campaign', type: CrmCampaignDto })
  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  cancel(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCampaignParamsDto,
    @Body() body: CancelCrmCampaignDto,
  ): Promise<CrmCampaign> {
    return this.campaigns.platformCancel(user.id, params.id, body.reason);
  }
}
