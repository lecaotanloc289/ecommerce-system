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
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type {
  VendorInvitation,
  VendorInvitationAcceptResult,
  VendorInvitationPage,
  VendorStaffMember,
} from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RateLimit } from '../common/rate-limit';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { requireVendorId } from '../vendor/vendor-scope';
import {
  InvitationAcceptDto,
  InvitationAcceptResultDto,
  InvitationCreateDto,
  InvitationDto,
  InvitationPageDto,
  InvitationParamsDto,
  InvitationQueryDto,
  StaffListDto,
  StaffParamsDto,
} from './vendor-staff.dto';
import { VendorStaffService } from './vendor-staff.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** Owner-only staff management; the vendor comes from the JWT and is re-verified in the DB. */
@ApiTags('vendor-staff')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER')
export class VendorStaffController {
  constructor(private readonly staff: VendorStaffService) {}

  @ApiOperation({ summary: 'Invite a staff member by email (the link is emailed, never returned)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The pending invitation', type: InvitationDto })
  @Post('invitations')
  @Idempotent()
  invite(
    @CurrentUser() user: AuthUser,
    @Body() body: InvitationCreateDto,
  ): Promise<VendorInvitation> {
    return this.staff.invite(requireVendorId(user), user.id, body.email);
  }

  @ApiOperation({ summary: 'Own invitations, newest first, with derived status' })
  @ZodResponse({ status: 200, description: 'Invitations', type: InvitationPageDto })
  @Get('invitations')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: InvitationQueryDto,
  ): Promise<VendorInvitationPage> {
    return this.staff.list(requireVendorId(user), query);
  }

  @ApiOperation({ summary: 'Revoke an invitation that was not accepted' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The revoked invitation', type: InvitationDto })
  @Post('invitations/:id/revoke')
  @HttpCode(200)
  @Idempotent()
  revoke(
    @CurrentUser() user: AuthUser,
    @Param() params: InvitationParamsDto,
  ): Promise<VendorInvitation> {
    return this.staff.revoke(requireVendorId(user), params.id);
  }

  @ApiOperation({ summary: 'Owner and staff of the vendor' })
  @ZodResponse({ status: 200, description: 'Members', type: StaffListDto })
  @Get('staff')
  listStaff(@CurrentUser() user: AuthUser): Promise<VendorStaffMember[]> {
    return this.staff.listStaff(requireVendorId(user));
  }

  @ApiOperation({ summary: 'Remove a staff member (the owner cannot be removed)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiNoContentResponse({ description: 'Removed' })
  @Delete('staff/:userId')
  @HttpCode(204)
  @Idempotent()
  remove(@CurrentUser() user: AuthUser, @Param() params: StaffParamsDto): Promise<void> {
    return this.staff.removeStaff(requireVendorId(user), params.userId);
  }
}

/** Invitee side: any signed-in user presents the emailed token. */
@ApiTags('vendor-staff')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor-invitations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class VendorInvitationAcceptController {
  constructor(private readonly staff: VendorStaffService) {}

  @ApiOperation({
    summary: 'Accept an invitation (verified email must match); then refresh the token',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'Joined vendor', type: InvitationAcceptResultDto })
  @Post('accept')
  @HttpCode(200)
  @RateLimit('strict')
  @Idempotent()
  accept(
    @CurrentUser() user: AuthUser,
    @Body() body: InvitationAcceptDto,
  ): Promise<VendorInvitationAcceptResult> {
    return this.staff.accept(user.id, body.token);
  }
}
