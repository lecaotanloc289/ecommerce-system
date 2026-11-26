import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
  CrmCustomerDetail,
  CrmCustomerPage,
  CrmSegmentCounts,
  ReplaceCustomerTags,
} from '@repo/core';
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
import { CrmCustomersService } from './crm-customers.service';
import {
  CreateCustomerNoteDto,
  CrmCustomerDetailDto,
  CrmCustomerListQueryDto,
  type CrmCustomerNote,
  CrmCustomerNoteDto,
  CrmCustomerNoteParamsDto,
  CrmCustomerPageDto,
  CrmCustomerParamsDto,
  CrmSegmentCountsDto,
  ReplaceCustomerTagsDto,
} from './crm.dto';

/** Vendor CRM: the shop's customers (C1–C4). Owner and staff; vendor from the JWT only. */
@ApiTags('vendor-crm')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/crm')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class CrmCustomersController {
  constructor(private readonly customers: CrmCustomersService) {}

  @ApiOperation({
    summary: 'Customers of the shop (≥ 1 paid, non-refunded sub-order), stats computed on read',
    description:
      'Filter by `segment`, `tag`, `productId` (bought it), `q` (name substring or customer id). ' +
      '`sort=last_order` (default) | `order_count`, both newest/highest first. `cursor` is the ' +
      'opaque `nextCursor` of the previous page (same `sort`); a malformed one → 422. No email or ' +
      'phone is ever returned.',
  })
  @ZodResponse({ status: 200, description: 'One page of customers', type: CrmCustomerPageDto })
  @Get('customers')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: CrmCustomerListQueryDto,
  ): Promise<CrmCustomerPage> {
    return this.customers.list(requireVendorId(user), query);
  }

  @ApiOperation({
    summary: 'Customer 360: stats, recent sub-orders, reviews on this shop, internal notes',
    description: 'Not a customer of this shop → 404 `crm.error.not-a-customer`.',
  })
  @ZodResponse({ status: 200, description: 'The customer', type: CrmCustomerDetailDto })
  @Get('customers/:customerId')
  detail(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCustomerParamsDto,
  ): Promise<CrmCustomerDetail> {
    return this.customers.detail(requireVendorId(user), params.customerId);
  }

  @ApiOperation({ summary: 'Replace the internal tags of a customer (≤ 10, lowercase)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The saved tags', type: ReplaceCustomerTagsDto })
  @Put('customers/:customerId/tags')
  @Idempotent()
  replaceTags(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCustomerParamsDto,
    @Body() body: ReplaceCustomerTagsDto,
  ): Promise<ReplaceCustomerTags> {
    return this.customers.replaceTags(requireVendorId(user), params.customerId, body);
  }

  @ApiOperation({ summary: 'Add an internal note about a customer' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The note', type: CrmCustomerNoteDto })
  @Post('customers/:customerId/notes')
  @Idempotent()
  addNote(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCustomerParamsDto,
    @Body() body: CreateCustomerNoteDto,
  ): Promise<CrmCustomerNote> {
    return this.customers.addNote(user.id, requireVendorId(user), params.customerId, body.body);
  }

  @ApiOperation({
    summary: 'Delete a note (its author or the shop owner; soft delete)',
    description: 'Unknown / already deleted → 404 `crm.error.note-not-found`; others → 403.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiNoContentResponse({ description: 'Deleted' })
  @Delete('customers/:customerId/notes/:noteId')
  @HttpCode(204)
  @Idempotent()
  deleteNote(
    @CurrentUser() user: AuthUser,
    @Param() params: CrmCustomerNoteParamsDto,
  ): Promise<void> {
    return this.customers.deleteNote(
      user.id,
      requireVendorId(user),
      params.customerId,
      params.noteId,
    );
  }

  @ApiOperation({ summary: 'Customers and marketing opt-ins per segment' })
  @ZodResponse({ status: 200, description: 'Segment counts', type: CrmSegmentCountsDto })
  @Get('segments')
  segments(@CurrentUser() user: AuthUser): Promise<CrmSegmentCounts> {
    return this.customers.segments(requireVendorId(user));
  }
}
