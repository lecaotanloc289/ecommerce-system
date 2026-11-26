import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VendorApplicationListItem, VendorApplicationMe } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { RateLimit } from '../common/rate-limit';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  VendorApplicationCreateDto,
  VendorApplicationListItemDto,
  VendorApplicationMeDto,
} from './vendor-applications.dto';
import { VendorApplicationsService } from './vendor-applications.service';

/** The signed-in customer's own seller application. The applicant always comes from the JWT. */
@ApiTags('vendor-applications')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class VendorApplicationsController {
  constructor(private readonly applications: VendorApplicationsService) {}

  @ApiOperation({
    summary: 'Apply to become a vendor (KYC documents referenced by upload keys)',
    description:
      'Keys come from `POST /v1/uploads/presign` (purpose `kyc`) and must belong to the caller ' +
      '(`upload.error.invalid-key` otherwise). One PENDING application at a time ' +
      '(`vendor.error.application-already-pending`); a user who already owns a shop gets 409 ' +
      '`common.error.conflict`. Re-applying after a rejection is allowed.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated ULID.' })
  @ZodResponse({
    status: 201,
    description: 'The PENDING application (KYC numbers masked)',
    type: VendorApplicationListItemDto,
  })
  @Post()
  @Idempotent()
  @RateLimit('strict')
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: VendorApplicationCreateDto,
  ): Promise<VendorApplicationListItem> {
    return this.applications.create(user.id, body);
  }

  @ApiOperation({ summary: 'Own applications, newest first (`latest` = `history[0]`)' })
  @ZodResponse({
    status: 200,
    description: 'Latest application + history',
    type: VendorApplicationMeDto,
  })
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<VendorApplicationMe> {
    return this.applications.listMine(user.id);
  }
}
