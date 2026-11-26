import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CrmAutomation } from '@repo/core';
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
import { CrmAutomationsService } from './crm-automations.service';
import {
  CrmAutomationDto,
  CrmAutomationListDto,
  CrmAutomationParamsDto,
  UpdateCrmAutomationDto,
} from './crm.dto';

/** Post-purchase automations (C8). Staff read; only the owner changes them (C13). */
@ApiTags('vendor-crm')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/crm/automations')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class CrmAutomationsController {
  constructor(private readonly automations: CrmAutomationsService) {}

  @ApiOperation({ summary: 'The three automations (unsaved ones: disabled, default delay)' })
  @ZodResponse({ status: 200, description: 'Automations', type: CrmAutomationListDto })
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CrmAutomation[]> {
    return this.automations.list(requireVendorId(user));
  }

  @ApiOperation({
    summary: 'Save one automation (owner only)',
    description:
      'delayDays: THANK_YOU 0..7, REVIEW_REQUEST 1..30, REORDER_REMINDER 7..180. `couponId` only ' +
      'on REORDER_REMINDER: own VENDOR coupon, active and valid now, code `^[A-Z0-9_-]{3,32}$` ' +
      '(else 422 `crm.error.coupon-invalid`). Templates: plain text, no links ' +
      '(`crm.error.links-not-allowed`), placeholders `{customerName}` `{shopName}` `{couponCode}` ' +
      '(`{couponCode}` without a coupon → `crm.error.unknown-placeholder`).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The automation', type: CrmAutomationDto })
  @Put(':kind')
  @Roles('VENDOR_OWNER')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmAutomationParamsDto,
    @Body() body: UpdateCrmAutomationDto,
  ): Promise<CrmAutomation> {
    return this.automations.update(user.id, requireVendorId(user), params.kind, body);
  }
}
