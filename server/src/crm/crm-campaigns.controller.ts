import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CrmCampaign, CrmCampaignPage, CrmCampaignPreview } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { IDEMPOTENCY_HEADER } from '../platform/platform.headers';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { requireVendorId } from '../vendor/vendor-scope';
import { CrmCampaignsService } from './crm-campaigns.service';
import {
  CreateCrmCampaignDto,
  CrmCampaignDto,
  CrmCampaignListQueryDto,
  CrmCampaignPageDto,
  CrmCampaignParamsDto,
  CrmCampaignPreviewDto,
  ScheduleCrmCampaignDto,
  UpdateCrmCampaignDto,
} from './crm.dto';

const TEMPLATE_RULES =
  'Templates: plain text, no links (`crm.error.links-not-allowed {match}`), placeholders ' +
  '`{customerName}` `{shopName}` `{couponCode}` only (`crm.error.unknown-placeholder`; ' +
  '`{couponCode}` needs a coupon). Coupon: own VENDOR coupon, active, valid ' +
  '(`crm.error.coupon-invalid`).';

/** Vendor CRM campaigns (C10). Owner + staff draft and preview; only the owner schedules / cancels. */
@ApiTags('vendor-crm')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/crm/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class CrmCampaignsController {
  constructor(private readonly campaigns: CrmCampaignsService) {}

  @ApiOperation({ summary: 'Own campaigns, newest first (cursor pagination)' })
  @ZodResponse({ status: 200, description: 'One page', type: CrmCampaignPageDto })
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: CrmCampaignListQueryDto,
  ): Promise<CrmCampaignPage> {
    return this.campaigns.list(requireVendorId(user), query);
  }

  @ApiOperation({ summary: 'Create a DRAFT campaign', description: TEMPLATE_RULES })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The draft', type: CrmCampaignDto })
  @Post()
  @Idempotent()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateCrmCampaignDto): Promise<CrmCampaign> {
    return this.campaigns.create(user.id, requireVendorId(user), body);
  }

  @ApiOperation({ summary: 'One own campaign with delivery stats' })
  @ZodResponse({ status: 200, description: 'The campaign', type: CrmCampaignDto })
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param() params: CrmCampaignParamsDto): Promise<CrmCampaign> {
    return this.campaigns.get(requireVendorId(user), params.id);
  }

  @ApiOperation({
    summary: 'Replace a DRAFT (other status → 409 `crm.error.campaign-not-editable`)',
    description: TEMPLATE_RULES,
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The draft', type: CrmCampaignDto })
  @Put(':id')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCampaignParamsDto,
    @Body() body: UpdateCrmCampaignDto,
  ): Promise<CrmCampaign> {
    return this.campaigns.update(requireVendorId(user), params.id, body);
  }

  @ApiOperation({
    summary: 'Audience size now + sample render (vi / en) — writes nothing',
    description:
      '`matchedCustomers` match the filter; `eligibleRecipients` also opted in to marketing.',
  })
  @ZodResponse({ status: 200, description: 'The preview', type: CrmCampaignPreviewDto })
  @Post(':id/preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCampaignParamsDto,
  ): Promise<CrmCampaignPreview> {
    return this.campaigns.preview(requireVendorId(user), params.id);
  }

  @ApiOperation({
    summary: 'Schedule a DRAFT (owner only): `scheduledAt` null = now, ≤ 30 days ahead',
    description:
      'Limit: `crmMaxCampaignsPerWeek` per sliding 7 days → 429 ' +
      '`crm.error.campaign-limit-reached`; nobody eligible now → 422 `crm.error.empty-audience`; ' +
      'not DRAFT → 409 `crm.error.campaign-not-editable`. The audience is resolved again at send ' +
      'time.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The scheduled campaign', type: CrmCampaignDto })
  @Post(':id/schedule')
  @HttpCode(200)
  @Roles('VENDOR_OWNER')
  @Idempotent()
  schedule(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCampaignParamsDto,
    @Body() body: ScheduleCrmCampaignDto,
  ): Promise<CrmCampaign> {
    return this.campaigns.schedule(user.id, requireVendorId(user), params.id, body);
  }

  @ApiOperation({
    summary: 'Cancel a DRAFT / SCHEDULED campaign (owner only)',
    description: 'Its not-yet-sent messages become SKIPPED (CAMPAIGN_CANCELLED).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The cancelled campaign', type: CrmCampaignDto })
  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('VENDOR_OWNER')
  @Idempotent()
  cancel(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCampaignParamsDto,
  ): Promise<CrmCampaign> {
    return this.campaigns.cancel(user.id, requireVendorId(user), params.id);
  }
}
