import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  VendorApplicationDetail,
  VendorApplicationListPage,
  VendorApplicationReviewResult,
} from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  VendorApplicationDetailDto,
  VendorApplicationListPageDto,
  VendorApplicationListQueryDto,
  VendorApplicationParamsDto,
  VendorApplicationReviewResultDto,
  VendorApproveDto,
  VendorRejectDto,
} from './vendor-applications.dto';
import { VendorApplicationsService } from './vendor-applications.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** Platform staff review of vendor applications. */
@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/vendor-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformVendorApplicationsController {
  constructor(private readonly applications: VendorApplicationsService) {}

  @ApiOperation({
    summary: 'Applications, newest first, optional `status` filter (KYC numbers masked)',
  })
  @ZodResponse({ status: 200, description: 'One page', type: VendorApplicationListPageDto })
  @Get()
  list(@Query() query: VendorApplicationListQueryDto): Promise<VendorApplicationListPage> {
    return this.applications.listForReview(query);
  }

  @ApiOperation({
    summary: 'One application with full KYC data and short-lived presigned document URLs',
  })
  @ZodResponse({ status: 200, description: 'The application', type: VendorApplicationDetailDto })
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorApplicationParamsDto,
  ): Promise<VendorApplicationDetail> {
    return this.applications.getForReview(user.id, params.id);
  }

  @ApiOperation({
    summary: 'Approve: creates the ACTIVE vendor, its wallet and the VENDOR_OWNER role',
    description:
      'The applicant gets the new role on their next access-token refresh. Not PENDING → 409 ' +
      '`vendor.error.application-not-pending`; slug taken → 409 `common.error.conflict`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({
    status: 200,
    description: 'Reviewed application',
    type: VendorApplicationReviewResultDto,
  })
  @Post(':id/approve')
  @HttpCode(200)
  @Idempotent()
  approve(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorApplicationParamsDto,
    @Body() body: VendorApproveDto,
  ): Promise<VendorApplicationReviewResult> {
    return this.applications.approve(user.id, params.id, body);
  }

  @ApiOperation({ summary: 'Reject a PENDING application with a reason' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({
    status: 200,
    description: 'Reviewed application',
    type: VendorApplicationReviewResultDto,
  })
  @Post(':id/reject')
  @HttpCode(200)
  @Idempotent()
  reject(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorApplicationParamsDto,
    @Body() body: VendorRejectDto,
  ): Promise<VendorApplicationReviewResult> {
    return this.applications.reject(user.id, params.id, body);
  }
}
